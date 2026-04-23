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

  // The batched invoice update uses $executeRaw(Prisma.sql`...`); we
  // can introspect the tagged-template's `values` to recover what would
  // have been written per invoice.
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
    $executeRaw: vi.fn(async (sql: Prisma.Sql) => {
      // Prisma.Sql holds interpolated values in `.values` — for the
      // batched invoice update these come in chunks of 3:
      //   [id, outstanding, status, id, outstanding, status, ...]
      const vals = sql.values;
      for (let i = 0; i + 2 < vals.length; i += 3) {
        const id = vals[i] as string;
        const outstanding = Number(vals[i + 1]);
        const status = vals[i + 2] as string;
        if (typeof id === "string" && id.startsWith("I")) {
          invoiceUpdates.push({ id, outstandingAmount: outstanding, status });
        }
      }
      return 0;
    }),
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

const inv = (
  id: string,
  billRef: string,
  daysOld: number,
  orig: number,
  outstanding: number = orig,
) => ({
  id,
  billRef,
  billDate: new Date(Date.now() - daysOld * 86400_000),
  originalAmount: new Prisma.Decimal(orig),
  outstandingAmount: new Prisma.Decimal(outstanding),
});

describe("allocateForParty", () => {
  it("records a TALLY_BILLWISE audit row without touching outstanding", async () => {
    // Tally has already applied R1 to B001 — reports I1 outstanding as 0.
    // Our engine records the audit row (for drill-down) but must not
    // deduct from outstandingAmount, otherwise we double-count.
    const { tx, createdRows, invoiceUpdates, partyUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [
        inv("I1", "B001", 60, 10000, /*outstanding*/ 0),
        inv("I2", "B002", 30, 5000),
      ],
      [{ id: "R1", amount: 10000, billRefs: [{ billRef: "B001", amount: 10000 }] }],
    );
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      receiptId: "R1",
      invoiceId: "I1",
      source: "TALLY_BILLWISE",
    });
    // I1 stays at Tally's 0, I2 stays at Tally's 5000
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

  it("does NOT FIFO the leftover of a bill-wise receipt", async () => {
    // A receipt that Tally stamped with a bill-ref (even if the ref's
    // bill is closed and not in our DB) must not spill onto unrelated
    // open bills. Tally already decided where that money went; our job
    // is only to mirror that decision, not reinvent it.
    const { tx, createdRows, invoiceUpdates, partyUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [
        inv("I1", "B001", 60, 4000, /*outstanding*/ 0), // Tally: paid
        inv("I2", "B002", 30, 6000),                     // still open
      ],
      [
        {
          id: "R1",
          amount: 10000,
          billRefs: [{ billRef: "B001", amount: 4000 }],
        },
      ],
    );
    // Only the bill-wise row for I1 is created. I2 stays fully open.
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0]).toMatchObject({
      invoiceId: "I1",
      source: "TALLY_BILLWISE",
    });
    expect(invoiceUpdates.find((u) => u.id === "I1")!.status).toBe("PAID");
    expect(invoiceUpdates.find((u) => u.id === "I2")!.status).toBe("OPEN");
    expect(invoiceUpdates.find((u) => u.id === "I2")!.outstandingAmount).toBe(
      6000,
    );
    // Bill-wise receipt leftover does NOT count as advance — the leftover
    // was meant for a bill Tally closed elsewhere, not an on-account credit.
    expect(partyUpdates[0].advanceAmount).toBe(0);
  });

  it("skips bill-refs that don't match any open invoice (no FIFO fallback)", async () => {
    const { tx, createdRows, invoiceUpdates, partyUpdates } = makeTx();
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
    // Unknown bill ref → nothing applied, nothing reported as advance.
    // The bill it was meant for is simply not in our DB (closed in Tally).
    expect(createdRows).toHaveLength(0);
    expect(invoiceUpdates.find((u) => u.id === "I1")!.outstandingAmount).toBe(
      5000,
    );
    expect(invoiceUpdates.find((u) => u.id === "I1")!.status).toBe("OPEN");
    expect(partyUpdates[0].advanceAmount).toBe(0);
  });

  it("reconciles invoice-sum down to closingBalance, oldest first", async () => {
    // Ledger says only 3000 is due, but two bills total 15000.
    // Expected: oldest (I1, 10k) knocked to 0 first; then I2 knocked
    // from 5k to 3k — final invoice-sum = 3000 matches ledger.
    const { tx, invoiceUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [inv("I1", "B001", 60, 10000), inv("I2", "B002", 30, 5000)],
      [], // no receipts synced — the gap is pure reconciliation
      3000, // closingBalance — truth per Tally
    );
    const i1 = invoiceUpdates.find((u) => u.id === "I1")!;
    const i2 = invoiceUpdates.find((u) => u.id === "I2")!;
    expect(i1.outstandingAmount).toBe(0);
    expect(i1.status).toBe("PAID");
    expect(i2.outstandingAmount).toBe(3000);
    expect(i2.status).toBe("OPEN");
  });

  it("caps a TALLY_BILLWISE audit row at the invoice's originalAmount", async () => {
    // Tally emitted an over-cap bill-ref (5k against a 3k bill). The
    // audit row must be capped so we don't claim a bill was paid more
    // than its face value. I2 is untouched — bill-wise receipts don't
    // fall through to FIFO.
    const { tx, createdRows, invoiceUpdates } = makeTx();
    await allocateForParty(
      tx as unknown as Prisma.TransactionClient,
      "P1",
      [
        inv("I1", "B001", 60, 3000, /*outstanding*/ 0),
        inv("I2", "B002", 30, 2000),
      ],
      [
        {
          id: "R1",
          amount: 5000,
          billRefs: [{ billRef: "B001", amount: 5000 }],
        },
      ],
    );
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0].invoiceId).toBe("I1");
    expect(Number(createdRows[0].amount)).toBe(3000);
    expect(invoiceUpdates.find((u) => u.id === "I1")!.status).toBe("PAID");
    expect(invoiceUpdates.find((u) => u.id === "I2")!.status).toBe("OPEN");
    expect(invoiceUpdates.find((u) => u.id === "I2")!.outstandingAmount).toBe(
      2000,
    );
  });
});
