import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { allocateForParty } from "./allocation";

/**
 * We don't want a real DB here — stub out the bits of the transaction
 * client the engine calls and assert on the createMany payload.
 */
function makeTx() {
  const deleted: unknown[] = [];
  const findManyCalls: unknown[] = [];
  const createdRows: Array<{
    receiptId: string;
    invoiceId: string;
    amount: Prisma.Decimal;
    source: string;
  }> = [];
  const invoiceUpdates: Array<{
    id: string;
    outstandingAmount: number;
    status: string;
  }> = [];
  const partyUpdates: Array<{ id: string; advanceAmount: number }> = [];

  const tx = {
    receiptAllocation: {
      deleteMany: vi.fn(async (args: unknown) => {
        deleted.push(args);
        return { count: 0 };
      }),
      findMany: vi.fn(async (args: unknown) => {
        findManyCalls.push(args);
        return [];
      }),
      createMany: vi.fn(async (args: { data: typeof createdRows }) => {
        createdRows.push(...args.data);
        return { count: args.data.length };
      }),
    },
    invoice: {
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: { outstandingAmount: Prisma.Decimal; status: string };
        }) => {
          invoiceUpdates.push({
            id: args.where.id,
            outstandingAmount: Number(args.data.outstandingAmount),
            status: args.data.status,
          });
          return {};
        },
      ),
    },
    party: {
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: { advanceAmount: Prisma.Decimal };
        }) => {
          partyUpdates.push({
            id: args.where.id,
            advanceAmount: Number(args.data.advanceAmount),
          });
          return {};
        },
      ),
    },
  };
  return { tx, createdRows, invoiceUpdates, partyUpdates };
}

const inv = (id: string, billRef: string, daysOld: number, orig: number) => ({
  id,
  billRef,
  billDate: new Date(Date.now() - daysOld * 86400_000),
  originalAmount: new Prisma.Decimal(orig),
});

describe("allocateForParty", () => {
  it("applies a Tally bill-wise allocation when billRef matches", async () => {
    const { tx, createdRows, invoiceUpdates, partyUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [inv("I1", "B001", 60, 10000), inv("I2", "B002", 30, 5000)],
      [{ id: "R1", amount: 10000, billRefs: [{ billRef: "B001", amount: 10000 }] }],
    );
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      receiptId: "R1",
      invoiceId: "I1",
      source: "TALLY_BILLWISE",
    });
    // I1 fully paid, I2 untouched
    expect(invoiceUpdates.find((u) => u.id === "I1")).toMatchObject({
      outstandingAmount: 0,
      status: "PAID",
    });
    expect(invoiceUpdates.find((u) => u.id === "I2")).toMatchObject({
      outstandingAmount: 5000,
      status: "OPEN",
    });
    expect(partyUpdates[0].advanceAmount).toBe(0);
  });

  it("falls through to FIFO against oldest bill when no billRef given", async () => {
    const { tx, createdRows, invoiceUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [inv("I1", "B001", 60, 10000), inv("I2", "B002", 30, 5000)],
      [{ id: "R1", amount: 12000 }],
    );
    // 10k goes to I1 (oldest), 2k rolls to I2
    expect(createdRows).toHaveLength(2);
    const toI1 = createdRows.find((r) => r.invoiceId === "I1");
    const toI2 = createdRows.find((r) => r.invoiceId === "I2");
    expect(Number(toI1!.amount)).toBe(10000);
    expect(Number(toI2!.amount)).toBe(2000);
    expect(toI1!.source).toBe("FIFO_DERIVED");
    expect(invoiceUpdates.find((u) => u.id === "I1")!.status).toBe("PAID");
    expect(invoiceUpdates.find((u) => u.id === "I2")!.status).toBe("OPEN");
    expect(invoiceUpdates.find((u) => u.id === "I2")!.outstandingAmount).toBe(
      3000,
    );
  });

  it("surfaces excess receipt as party advance", async () => {
    const { tx, createdRows, partyUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [inv("I1", "B001", 60, 5000)],
      [{ id: "R1", amount: 8000 }],
    );
    expect(createdRows).toHaveLength(1);
    expect(Number(createdRows[0].amount)).toBe(5000);
    expect(partyUpdates[0].advanceAmount).toBe(3000);
  });

  it("combines Tally bill-wise with FIFO for the leftover", async () => {
    const { tx, createdRows, invoiceUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [inv("I1", "B001", 60, 4000), inv("I2", "B002", 30, 6000)],
      [
        {
          id: "R1",
          amount: 10000,
          billRefs: [{ billRef: "B001", amount: 4000 }],
        },
      ],
    );
    // 4k to I1 via bill-wise, 6k to I2 via FIFO
    expect(createdRows).toHaveLength(2);
    const toI1 = createdRows.find((r) => r.invoiceId === "I1")!;
    const toI2 = createdRows.find((r) => r.invoiceId === "I2")!;
    expect(toI1.source).toBe("TALLY_BILLWISE");
    expect(toI2.source).toBe("FIFO_DERIVED");
    expect(invoiceUpdates.every((u) => u.status === "PAID")).toBe(true);
  });

  it("ignores bill-refs that don't match any open invoice", async () => {
    const { tx, createdRows, partyUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [inv("I1", "B001", 60, 5000)],
      [
        {
          id: "R1",
          amount: 5000,
          billRefs: [{ billRef: "BXXX-UNKNOWN", amount: 5000 }],
        },
      ],
    );
    // Unknown bill ref drops through to FIFO; applied to I1.
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0].source).toBe("FIFO_DERIVED");
    expect(partyUpdates[0].advanceAmount).toBe(0);
  });

  it("caps a bill-wise allocation at the invoice's remaining capacity", async () => {
    const { tx, createdRows, invoiceUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [inv("I1", "B001", 60, 3000), inv("I2", "B002", 30, 2000)],
      [
        {
          id: "R1",
          amount: 5000,
          // Tally claims 5000 against B001 but B001 is only 3000 — cap it.
          billRefs: [{ billRef: "B001", amount: 5000 }],
        },
      ],
    );
    // 3k capped onto I1 bill-wise; 2k rolls to I2 via FIFO
    const toI1 = createdRows.find((r) => r.invoiceId === "I1")!;
    const toI2 = createdRows.find((r) => r.invoiceId === "I2")!;
    expect(Number(toI1.amount)).toBe(3000);
    expect(Number(toI2.amount)).toBe(2000);
    expect(invoiceUpdates.every((u) => u.status === "PAID")).toBe(true);
  });
});
