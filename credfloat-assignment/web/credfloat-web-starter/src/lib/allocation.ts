/**
 * Receipt allocation engine.
 *
 * For each party, reconciles Invoice.outstandingAmount and Party.advanceAmount
 * by applying receipts against open invoices. Two passes:
 *
 *   1. TALLY_BILLWISE — use explicit receipt → bill references that the
 *      Tally sync provided (via BILLALLOCATIONS on the receipt voucher).
 *      These rows encode what Tally itself has already done on its side.
 *
 *   2. FIFO_DERIVED — for whatever remains of each receipt (either unmarked
 *      in Tally, or partially unallocated), apply it against still-open
 *      invoices oldest-first (by billDate ASC). This is how on-account
 *      payments get chased to the right bills without human input.
 *
 * MANUAL rows are preserved untouched — staff overrides win over the engine.
 *
 * The engine is idempotent: every sync wipes non-MANUAL allocations for
 * the party and re-derives from scratch. Reliable as long as the input
 * invoices + receipts are consistent with Tally.
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type BillRefAllocation = {
  billRef: string;
  amount: number;
};

export type ReceiptInput = {
  /** DB id of the receipt row (after upsert). */
  id: string;
  amount: number;
  /** Optional explicit allocations from Tally's BILLALLOCATIONS. */
  billRefs?: BillRefAllocation[];
};

export type AllocationSummary = {
  partyId: string;
  billwiseApplied: number;
  fifoApplied: number;
  advanceLeft: number;
  invoicesTouched: number;
};

/** Two-decimal-safe subtraction guard; amounts come in as floats. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Allocate for a single party. Call inside a transaction alongside the
 * invoice + receipt upserts for correctness.
 *
 * Contract:
 *  - `invoices` must be all current open invoices for the party,
 *    with `originalAmount` populated.
 *  - `receipts` must be all current receipts for the party.
 *  - Existing ReceiptAllocation rows for the party's receipts that are
 *    not MANUAL will be deleted and re-derived.
 *  - On return, Invoice.outstandingAmount and Party.advanceAmount are
 *    updated in-place.
 */
export async function allocateForParty(
  tx: Prisma.TransactionClient,
  partyId: string,
  invoices: Array<{
    id: string;
    billRef: string;
    billDate: Date;
    originalAmount: Prisma.Decimal;
  }>,
  receipts: ReceiptInput[],
  /**
   * Party.closingBalance from Tally — the canonical "money owed" at the
   * ledger level. After TALLY_BILLWISE and FIFO_DERIVED passes, if the
   * sum of invoice outstandings still exceeds this number, apply the
   * gap FIFO-style (oldest first) so bill-level numbers reconcile with
   * the ledger. This closes the gap caused by receipts Tally knows
   * about but that we didn't sync (typically receipts on non-debtor
   * ledgers like bank/cash in our connector). Pass `undefined` to skip
   * the reconciliation pass entirely — useful in tests and when the
   * caller doesn't have a trustworthy ledger balance to reconcile
   * against.
   */
  closingBalance?: number,
): Promise<AllocationSummary> {
  // Drop everything non-MANUAL on this party's receipts. MANUAL survives.
  await tx.receiptAllocation.deleteMany({
    where: {
      receipt: { partyId },
      source: { not: "MANUAL" },
    },
  });

  // Map preserved MANUAL allocations by invoice so we subtract them from
  // invoice capacity before running the passes.
  const manualRows = await tx.receiptAllocation.findMany({
    where: {
      receipt: { partyId },
      source: "MANUAL",
    },
    select: { invoiceId: true, receiptId: true, amount: true },
  });
  const manualByInvoice = new Map<string, number>();
  const manualByReceipt = new Map<string, number>();
  for (const m of manualRows) {
    const a = Number(m.amount);
    manualByInvoice.set(m.invoiceId, (manualByInvoice.get(m.invoiceId) ?? 0) + a);
    manualByReceipt.set(m.receiptId, (manualByReceipt.get(m.receiptId) ?? 0) + a);
  }

  // Remaining capacity per invoice = originalAmount − MANUAL already applied.
  const invoiceRemaining = new Map<string, number>();
  const invoiceByRef = new Map<string, string>();
  const invoicesSortedByDate = [...invoices].sort(
    (a, b) => a.billDate.getTime() - b.billDate.getTime(),
  );
  for (const inv of invoicesSortedByDate) {
    const original = Number(inv.originalAmount);
    const manual = manualByInvoice.get(inv.id) ?? 0;
    invoiceRemaining.set(inv.id, round2(original - manual));
    invoiceByRef.set(inv.billRef, inv.id);
  }

  // Remaining amount per receipt = receipt.amount − MANUAL already applied.
  const receiptRemaining = new Map<string, number>();
  for (const r of receipts) {
    const manual = manualByReceipt.get(r.id) ?? 0;
    receiptRemaining.set(r.id, round2(r.amount - manual));
  }

  type NewRow = {
    receiptId: string;
    invoiceId: string;
    amount: number;
    source: "TALLY_BILLWISE" | "FIFO_DERIVED";
  };
  const newRows: NewRow[] = [];

  // Pass 1 — Tally-provided bill-wise allocations.
  let billwiseApplied = 0;
  for (const r of receipts) {
    if (!r.billRefs || r.billRefs.length === 0) continue;
    for (const alloc of r.billRefs) {
      const invId = invoiceByRef.get(alloc.billRef);
      if (!invId) continue; // bill ref not among this party's open invoices
      const invCap = invoiceRemaining.get(invId) ?? 0;
      const recLeft = receiptRemaining.get(r.id) ?? 0;
      const applied = round2(Math.min(alloc.amount, invCap, recLeft));
      if (applied <= 0) continue;
      newRows.push({
        receiptId: r.id,
        invoiceId: invId,
        amount: applied,
        source: "TALLY_BILLWISE",
      });
      invoiceRemaining.set(invId, round2(invCap - applied));
      receiptRemaining.set(r.id, round2(recLeft - applied));
      billwiseApplied += applied;
    }
  }

  // Pass 2 — FIFO on remainders. Receipts by receiptDate asc, invoices by billDate asc.
  const receiptsOrdered = [...receipts].sort((a, b) => {
    // stable-ish; same-date receipts fall back to id order
    const aDate = (a as ReceiptInput & { receiptDate?: Date }).receiptDate;
    const bDate = (b as ReceiptInput & { receiptDate?: Date }).receiptDate;
    if (aDate && bDate) return aDate.getTime() - bDate.getTime();
    return a.id.localeCompare(b.id);
  });

  let fifoApplied = 0;
  for (const r of receiptsOrdered) {
    let recLeft = receiptRemaining.get(r.id) ?? 0;
    if (recLeft <= 0) continue;
    for (const inv of invoicesSortedByDate) {
      if (recLeft <= 0) break;
      const invCap = invoiceRemaining.get(inv.id) ?? 0;
      if (invCap <= 0) continue;
      const applied = round2(Math.min(recLeft, invCap));
      if (applied <= 0) continue;

      // If an earlier pass already created a row for this (receipt,invoice),
      // merge by amount rather than violating the unique index.
      const existing = newRows.find(
        (x) => x.receiptId === r.id && x.invoiceId === inv.id,
      );
      if (existing) {
        existing.amount = round2(existing.amount + applied);
      } else {
        newRows.push({
          receiptId: r.id,
          invoiceId: inv.id,
          amount: applied,
          source: "FIFO_DERIVED",
        });
      }
      invoiceRemaining.set(inv.id, round2(invCap - applied));
      recLeft = round2(recLeft - applied);
      fifoApplied += applied;
    }
    receiptRemaining.set(r.id, recLeft);
  }

  // Persist all new allocation rows.
  if (newRows.length > 0) {
    await tx.receiptAllocation.createMany({
      data: newRows.map((r) => ({
        receiptId: r.receiptId,
        invoiceId: r.invoiceId,
        amount: new Prisma.Decimal(r.amount),
        source: r.source,
      })),
    });
  }

  // Update invoice.outstandingAmount = originalAmount − sum(allocations).
  // Iterate: sum up all allocations (MANUAL + newly derived) per invoice.
  const totalByInvoice = new Map<string, number>();
  for (const m of manualRows) {
    totalByInvoice.set(
      m.invoiceId,
      (totalByInvoice.get(m.invoiceId) ?? 0) + Number(m.amount),
    );
  }
  for (const row of newRows) {
    totalByInvoice.set(
      row.invoiceId,
      (totalByInvoice.get(row.invoiceId) ?? 0) + row.amount,
    );
  }

  // Per-invoice outstanding after the allocation passes.
  const invoiceOutstanding = new Map<string, number>();
  for (const inv of invoices) {
    const allocated = totalByInvoice.get(inv.id) ?? 0;
    invoiceOutstanding.set(
      inv.id,
      round2(Math.max(0, Number(inv.originalAmount) - allocated)),
    );
  }

  // Ledger reconciliation (opt-in). If the caller passed a trustworthy
  // closingBalance and our invoice-sum still exceeds it, Tally is
  // netting in receipts we don't have allocation rows for (typically
  // because they landed on ledgers outside Sundry Debtors and our
  // connector skipped them). Close the gap by knocking down oldest
  // bills first so ageing buckets match the ledger reality. No
  // allocation rows created — this is a reconciliation tail, not a
  // real receipt.
  let reconciled = 0;
  if (typeof closingBalance === "number") {
    const target = Math.max(0, closingBalance);
    let currentSum = 0;
    for (const [, out] of invoiceOutstanding) currentSum += out;
    currentSum = round2(currentSum);

    if (currentSum > target) {
      let gap = round2(currentSum - target);
      for (const inv of invoicesSortedByDate) {
        if (gap <= 0.01) break;
        const out = invoiceOutstanding.get(inv.id) ?? 0;
        if (out <= 0) continue;
        const knock = round2(Math.min(gap, out));
        invoiceOutstanding.set(inv.id, round2(out - knock));
        gap = round2(gap - knock);
        reconciled = round2(reconciled + knock);
      }
    }
  }

  // Batch all invoice updates into a single SQL UPDATE ... FROM VALUES
  // statement. At 73-party scale with 30+ invoices per party this drops
  // us from ~2000 round-trips to 1 per party.
  type InvUpdate = { id: string; outstanding: number; status: "OPEN" | "PAID" };
  const invUpdates: InvUpdate[] = invoices.map((inv) => {
    const outstanding = invoiceOutstanding.get(inv.id) ?? 0;
    const status: "OPEN" | "PAID" = outstanding <= 0.01 ? "PAID" : "OPEN";
    return { id: inv.id, outstanding, status };
  });

  let invoicesTouched = 0;
  if (invUpdates.length > 0) {
    const values = invUpdates.map(
      (u) => Prisma.sql`(${u.id}::text, ${u.outstanding}::numeric, ${u.status}::"InvoiceStatus")`,
    );
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Invoice" AS i
      SET "outstandingAmount" = v.outstanding,
          "status" = v.status,
          "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(values, ",")}) AS v(id, outstanding, status)
      WHERE i."id" = v.id
    `);
    invoicesTouched = invUpdates.length;
  }

  // Party advance = sum of unconsumed receipt remainders (excess payments).
  let advanceLeft = 0;
  for (const [, left] of receiptRemaining) advanceLeft += left;
  advanceLeft = round2(advanceLeft);

  await tx.party.update({
    where: { id: partyId },
    data: { advanceAmount: new Prisma.Decimal(advanceLeft) },
  });

  return {
    partyId,
    billwiseApplied: round2(billwiseApplied),
    fifoApplied: round2(fifoApplied),
    advanceLeft,
    invoicesTouched,
  };
}

/**
 * Run the engine across all parties that have any receipts. Parties
 * without receipts don't need an engine run — their invoice outstanding
 * is already correct at `originalAmount`.
 */
export async function allocateAllDirty(
  prisma: PrismaClient,
  partyIds: string[],
): Promise<AllocationSummary[]> {
  const summaries: AllocationSummary[] = [];
  for (const partyId of partyIds) {
    const [invoices, receipts] = await Promise.all([
      prisma.invoice.findMany({
        where: { partyId, status: { in: ["OPEN", "PAID"] } },
        select: { id: true, billRef: true, billDate: true, originalAmount: true },
        orderBy: { billDate: "asc" },
      }),
      prisma.receipt.findMany({
        where: { partyId },
        select: { id: true, amount: true, receiptDate: true },
        orderBy: { receiptDate: "asc" },
      }),
    ]);

    // Bill-ref allocations live on ReceiptAllocation rows with source
    // TALLY_BILLWISE — but those are what we're about to rebuild, so we
    // need the *input* version. The sync route passes those in directly
    // via a separate call path; allocateAllDirty only handles the
    // already-persisted case where Tally bill-refs were stored on the
    // receipt at ingest. For the cron's post-sync pass we therefore
    // assume billRefs are not needed (they were resolved at ingest).
    const s = await prisma.$transaction(
      async (tx) =>
        allocateForParty(
          tx,
          partyId,
          invoices,
          receipts.map((r) => ({ id: r.id, amount: Number(r.amount) })),
        ),
      { maxWait: 10_000, timeout: 120_000 },
    );
    summaries.push(s);
  }
  return summaries;
}
