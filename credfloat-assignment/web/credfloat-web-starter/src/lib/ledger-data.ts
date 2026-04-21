import { prisma } from "@/lib/prisma";
import type { LedgerPeriod } from "@/lib/ledger-token";
import { resolvePeriod } from "@/lib/ledger-token";

/**
 * One transaction row as it appears in a Tally-style ledger statement.
 * Debit increases debtor balance (sale), credit reduces it (receipt /
 * credit note). Running balance = running total of debit − credit.
 */
export type LedgerRow = {
  date: Date;
  voucher: string;
  particulars: string;
  debit: number;
  credit: number;
  runningBalance: number;
};

export type LedgerStatement = {
  firm: { name: string; frn: string | null; partnerName: string | null; partnerMno: string | null };
  clientCompany: { displayName: string; tallyCompanyName: string };
  party: { name: string; address: string | null };
  period: { from: string; to: string; label: string };
  openingBalance: number;
  rows: LedgerRow[];
  closingBalance: number;
  totals: { debit: number; credit: number };
  generatedAt: Date;
};

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
            },
          },
        },
      },
    },
  });
  if (!party) return null;

  const { start, end, label } = resolvePeriod(period);
  const isOpenOnly = period.type === "OPEN_ITEMS_ONLY";

  const invoiceWhere = isOpenOnly
    ? { partyId, status: "OPEN" as const, outstandingAmount: { gt: 0 } }
    : {
        partyId,
        ...(start ? { billDate: { gte: start, lte: end } } : { billDate: { lte: end } }),
      };

  const receiptWhere = isOpenOnly
    ? { partyId, id: "__never__" } // no receipts in open-only mode
    : {
        partyId,
        ...(start
          ? { receiptDate: { gte: start, lte: end } }
          : { receiptDate: { lte: end } }),
      };

  const [invoices, receipts, priorInvoices, priorReceipts] = await Promise.all([
    prisma.invoice.findMany({
      where: invoiceWhere,
      orderBy: { billDate: "asc" },
      select: {
        billRef: true,
        billDate: true,
        originalAmount: true,
        outstandingAmount: true,
        status: true,
      },
    }),
    prisma.receipt.findMany({
      where: receiptWhere,
      orderBy: { receiptDate: "asc" },
      select: {
        voucherRef: true,
        receiptDate: true,
        amount: true,
      },
    }),
    start
      ? prisma.invoice.aggregate({
          where: { partyId, billDate: { lt: start } },
          _sum: { originalAmount: true },
        })
      : Promise.resolve(null),
    start
      ? prisma.receipt.aggregate({
          where: { partyId, receiptDate: { lt: start } },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
  ]);

  const openingBalance = start
    ? Number(priorInvoices?._sum.originalAmount ?? 0) -
      Number(priorReceipts?._sum.amount ?? 0)
    : 0;

  const rows: LedgerRow[] = [];
  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;

  type Entry =
    | { kind: "inv"; date: Date; ref: string; amt: number }
    | { kind: "rec"; date: Date; ref: string; amt: number };
  const merged: Entry[] = [
    ...invoices.map<Entry>((i) => ({
      kind: "inv",
      date: i.billDate,
      ref: i.billRef,
      amt: Number(i.originalAmount),
    })),
    ...receipts.map<Entry>((r) => ({
      kind: "rec",
      date: r.receiptDate,
      ref: r.voucherRef,
      amt: Number(r.amount),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const e of merged) {
    if (e.kind === "inv") {
      running += e.amt;
      totalDebit += e.amt;
      rows.push({
        date: e.date,
        voucher: e.ref,
        particulars: `Sales — bill ${e.ref}`,
        debit: e.amt,
        credit: 0,
        runningBalance: running,
      });
    } else {
      running -= e.amt;
      totalCredit += e.amt;
      rows.push({
        date: e.date,
        voucher: e.ref,
        particulars: `Receipt — voucher ${e.ref}`,
        debit: 0,
        credit: e.amt,
        runningBalance: running,
      });
    }
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
