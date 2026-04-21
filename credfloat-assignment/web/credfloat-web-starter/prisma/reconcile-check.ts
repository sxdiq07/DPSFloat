/**
 * Reconciliation diagnostic.
 *
 * Prints a per-firm summary comparing three views of receivables:
 *  - Ledger view: sum of positive Party.closingBalance (Tally truth)
 *  - Invoice view: sum of Invoice.outstandingAmount (post-FIFO)
 *  - Allocation view: total receipt value explained by ReceiptAllocation rows
 *
 * Also lists the top 10 parties where invoice-view disagrees with
 * ledger-view by the largest absolute amount. These are the debtors
 * whose Tally ledger can't be fully explained by the receipts we synced
 * — typically because Tally credited them from a Journal or from a
 * receipt on a non-debtor ledger we skipped.
 *
 * Run with:
 *   npx tsx prisma/reconcile-check.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

async function main() {
  const firms = await prisma.firm.findMany({
    select: { id: true, name: true },
  });

  for (const firm of firms) {
    console.log(`\n━━━ ${firm.name} (${firm.id}) ━━━`);

    const [ledgerAgg, invoiceAgg, allocationAgg, receiptAgg, partyStats] =
      await Promise.all([
        prisma.party.aggregate({
          where: { clientCompany: { firmId: firm.id }, closingBalance: { gt: 0 } },
          _sum: { closingBalance: true },
          _count: true,
        }),
        prisma.invoice.aggregate({
          where: {
            clientCompany: { firmId: firm.id },
            status: "OPEN",
            outstandingAmount: { gt: 0 },
          },
          _sum: { outstandingAmount: true },
          _count: true,
        }),
        prisma.receiptAllocation.aggregate({
          where: { invoice: { clientCompany: { firmId: firm.id } } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.receipt.aggregate({
          where: { clientCompany: { firmId: firm.id } },
          _sum: { amount: true },
          _count: true,
        }),
        prisma.party.aggregate({
          where: { clientCompany: { firmId: firm.id } },
          _sum: { advanceAmount: true },
        }),
      ]);

    const ledgerTotal = Number(ledgerAgg._sum.closingBalance ?? 0);
    const invoiceTotal = Number(invoiceAgg._sum.outstandingAmount ?? 0);
    const allocatedTotal = Number(allocationAgg._sum.amount ?? 0);
    const receiptTotal = Number(receiptAgg._sum.amount ?? 0);
    const advanceTotal = Number(partyStats._sum.advanceAmount ?? 0);

    console.log(`  Ledger view   : ${inr(ledgerTotal)} (${ledgerAgg._count} parties with >0 balance)`);
    console.log(`  Invoice view  : ${inr(invoiceTotal)} (${invoiceAgg._count} open invoices)`);
    console.log(`  Receipts sync : ${inr(receiptTotal)} (${receiptAgg._count} rows)`);
    console.log(`  Allocations   : ${inr(allocatedTotal)} (${allocationAgg._count} rows)`);
    console.log(`  Advances      : ${inr(advanceTotal)}`);

    const drift = Math.abs(ledgerTotal - invoiceTotal);
    const driftPct = ledgerTotal > 0 ? (drift / ledgerTotal) * 100 : 0;
    if (drift < 100) {
      console.log(`  ✓ Ledger ≈ Invoice sum (drift ${inr(drift)})`);
    } else {
      console.log(
        `  ⚠ DRIFT: Ledger vs Invoice sum differ by ${inr(drift)} (${driftPct.toFixed(1)}%)`,
      );
      console.log(`    — the reconciliation pass caps invoices to ledger per-party,`);
      console.log(`      so the firm-level sum should still match. If it doesn't, investigate.`);
    }

    // Per-party drift — ledger balance vs sum of their open invoice outstandings
    const parties = await prisma.party.findMany({
      where: { clientCompany: { firmId: firm.id } },
      select: {
        id: true,
        tallyLedgerName: true,
        mailingName: true,
        closingBalance: true,
        advanceAmount: true,
        clientCompany: { select: { displayName: true, tallyCompanyName: true } },
        invoices: {
          where: { status: "OPEN", outstandingAmount: { gt: 0 } },
          select: { outstandingAmount: true },
        },
      },
    });

    const drifts = parties
      .map((p) => {
        const ledger = Math.max(0, Number(p.closingBalance));
        const invoiceSum = p.invoices.reduce(
          (s, i) => s + Number(i.outstandingAmount),
          0,
        );
        return {
          name: p.mailingName || p.tallyLedgerName,
          client: p.clientCompany.displayName,
          ledger,
          invoiceSum,
          advance: Number(p.advanceAmount),
          drift: ledger - invoiceSum,
        };
      })
      .filter((d) => Math.abs(d.drift) > 100)
      .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
      .slice(0, 15);

    if (drifts.length > 0) {
      console.log(`\n  Top ${drifts.length} parties where ledger ≠ invoice-sum:`);
      console.log(
        `  ${"Party".padEnd(40)}  ${"Ledger".padStart(14)}  ${"Bills".padStart(14)}  ${"Δ".padStart(14)}`,
      );
      for (const d of drifts) {
        const name = (d.name.length > 38 ? d.name.slice(0, 37) + "…" : d.name).padEnd(
          40,
        );
        console.log(
          `  ${name}  ${inr(d.ledger).padStart(14)}  ${inr(d.invoiceSum).padStart(14)}  ${(d.drift >= 0 ? "+" : "") + inr(d.drift)}`,
        );
      }
      console.log(
        `\n  Note: positive Δ = ledger is higher than invoices (we're missing invoices or have over-FIFO'd).`,
      );
      console.log(
        `        negative Δ = invoices higher than ledger (should be ~0 after reconciliation pass).`,
      );
    } else {
      console.log(`\n  ✓ Every party's ledger balance matches sum of open-invoice residuals within ₹100.`);
    }

    // Sanity: every receipt should be fully allocated OR contribute to advance.
    // unallocated = receipt.amount - sum(its allocation rows)
    const receipts = await prisma.receipt.findMany({
      where: { clientCompany: { firmId: firm.id } },
      select: {
        id: true,
        voucherRef: true,
        amount: true,
        party: { select: { tallyLedgerName: true } },
        allocations: { select: { amount: true } },
      },
    });
    let unallocated = 0;
    for (const r of receipts) {
      const consumed = r.allocations.reduce((s, a) => s + Number(a.amount), 0);
      unallocated += Math.max(0, Number(r.amount) - consumed);
    }
    console.log(
      `\n  Receipts unexplained by allocations: ${inr(unallocated)} — this should equal the advance total (${inr(advanceTotal)}) within rounding.`,
    );
    const diff = Math.abs(unallocated - advanceTotal);
    if (diff < 100) {
      console.log(`  ✓ Advance ↔ unallocated reconciles.`);
    } else {
      console.log(`  ⚠ Off by ${inr(diff)} — advance field drifted from allocation rows.`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
