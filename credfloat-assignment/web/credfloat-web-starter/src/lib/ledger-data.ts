import { prisma } from "@/lib/prisma";
import type { LedgerPeriod } from "@/lib/ledger-token";
import { resolvePeriod } from "@/lib/ledger-token";

/**
 * One transaction row as it appears in a Tally-style ledger statement.
 * Debit increases debtor balance (sale / debit-note), credit reduces
 * it (receipt / credit-note / journal-cr). Running balance = opening
 * + cumulative (debit - credit) through this row.
 */
export type LedgerRow = {
  date: Date;
  voucher: string;
  voucherType: string;
  particulars: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type LedgerStatement = {
  firm: {
    name: string;
    frn: string | null;
    partnerName: string | null;
    partnerMno: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    upiId: string | null;
  };
  clientCompany: { displayName: string; tallyCompanyName: string };
  party: { name: string; address: string | null };
  period: { from: string; to: string; label: string };
  openingBalance: number;
  rows: LedgerRow[];
  closingBalance: number;
  totals: { debit: number; credit: number };
  generatedAt: Date;
};

/** Prettifies enum to title-case for display. */
function voucherTypeLabel(t: string): string {
  return t
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export async function buildLedgerStatement(
  partyId: string,
  period: LedgerPeriod,
): Promise<LedgerStatement | null> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    include: {
      clientCompany: {
        include: {
          firm: {
            select: {
              name: true,
              frn: true,
              partnerName: true,
              partnerMno: true,
              bankName: true,
              bankAccountName: true,
              bankAccountNumber: true,
              bankIfsc: true,
              upiId: true,
            },
          },
        },
      },
    },
  });
  if (!party) return null;

  const { start, end, label } = resolvePeriod(period);
  const isOpenOnly = period.type === "OPEN_ITEMS_ONLY";

  // OPEN_ITEMS_ONLY keeps the old bill-level view (invoices with
  // outstanding > 0 as debit rows). Every other period draws from the
  // full LedgerEntry table so the drill-down matches Tally 1:1.
  if (isOpenOnly) {
    const invoices = await prisma.invoice.findMany({
      where: {
        partyId,
        status: "OPEN",
        outstandingAmount: { gt: 0 },
      },
      orderBy: { billDate: "asc" },
      select: { billRef: true, billDate: true, outstandingAmount: true },
    });
    const rows: LedgerRow[] = [];
    let running = 0;
    let totalDebit = 0;
    for (const i of invoices) {
      const amt = Number(i.outstandingAmount);
      running += amt;
      totalDebit += amt;
      rows.push({
        date: i.billDate,
        voucher: i.billRef,
        voucherType: "Sales",
        particulars: `Open bill ${i.billRef}`,
        debit: amt,
        credit: 0,
        runningBalance: running,
      });
    }
    return {
      firm: party.clientCompany.firm,
      clientCompany: {
        displayName: party.clientCompany.displayName,
        tallyCompanyName: party.clientCompany.tallyCompanyName,
      },
      party: {
        name: party.mailingName || party.tallyLedgerName,
        address: party.address,
      },
      period: { from: "—", to: end.toISOString().slice(0, 10), label },
      openingBalance: 0,
      rows,
      closingBalance: running,
      totals: { debit: totalDebit, credit: 0 },
      generatedAt: new Date(),
    };
  }

  // Day-book-based view — pull entries from LedgerEntry, ordered by date.
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      partyId,
      ...(start
        ? { voucherDate: { gte: start, lte: end } }
        : { voucherDate: { lte: end } }),
    },
    orderBy: [{ voucherDate: "asc" }, { voucherRef: "asc" }],
    select: {
      voucherDate: true,
      voucherType: true,
      voucherRef: true,
      counterparty: true,
      narration: true,
      debit: true,
      credit: true,
    },
  });

  // Opening balance. If the period doesn't have a lower bound (all
  // history), opening = Party.openingBalance (Tally's carry-forward).
  // If there's a lower bound, opening = Tally carry-forward + sum of
  // entries BEFORE the window.
  let openingBalance = Number(party.openingBalance ?? 0);
  if (start) {
    const priorAgg = await prisma.ledgerEntry.aggregate({
      where: { partyId, voucherDate: { lt: start } },
      _sum: { debit: true, credit: true },
    });
    const priorDebit = Number(priorAgg._sum.debit ?? 0);
    const priorCredit = Number(priorAgg._sum.credit ?? 0);
    openingBalance += priorDebit - priorCredit;
  }

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: LedgerRow[] = entries.map((e) => {
    const d = Number(e.debit);
    const c = Number(e.credit);
    running += d - c;
    totalDebit += d;
    totalCredit += c;
    const counter = e.counterparty || "—";
    return {
      date: e.voucherDate,
      voucher: e.voucherRef,
      voucherType: voucherTypeLabel(e.voucherType),
      particulars: e.narration?.trim()
        ? `${counter} · ${e.narration.trim()}`
        : counter,
      debit: d,
      credit: c,
      runningBalance: running,
    };
  });

  return {
    firm: party.clientCompany.firm,
    clientCompany: {
      displayName: party.clientCompany.displayName,
      tallyCompanyName: party.clientCompany.tallyCompanyName,
    },
    party: {
      name: party.mailingName || party.tallyLedgerName,
      address: party.address,
    },
    period: {
      from: start ? start.toISOString().slice(0, 10) : "—",
      to: end.toISOString().slice(0, 10),
      label,
    },
    openingBalance,
    rows,
    closingBalance: running,
    totals: { debit: totalDebit, credit: totalCredit },
    generatedAt: new Date(),
  };
}
