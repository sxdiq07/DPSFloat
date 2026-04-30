import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [
    firms, staff, clients, parties, invoices, lineItems, receipts, allocations,
    ledgerEntries, reminderRules, remindersSent, notes, promises, callLogs,
    portalTokens, savedViews, activityLog, cronRuns, itemTemplates,
  ] = await Promise.all([
    prisma.firm.count(),
    prisma.firmStaff.count(),
    prisma.clientCompany.count(),
    prisma.party.count(),
    prisma.invoice.count(),
    prisma.invoiceLineItem.count(),
    prisma.receipt.count(),
    prisma.receiptAllocation.count(),
    prisma.ledgerEntry.count(),
    prisma.reminderRule.count(),
    prisma.reminderSent.count(),
    prisma.note.count(),
    prisma.promiseToPay.count(),
    prisma.callLog.count(),
    prisma.portalToken.count(),
    prisma.savedView.count(),
    prisma.activityLog.count(),
    prisma.cronRun.count(),
    prisma.invoiceItemTemplate.count(),
  ]);

  console.log("=== ROW COUNTS ===");
  console.table({
    Firm: firms,
    FirmStaff: staff,
    ClientCompany: clients,
    Party: parties,
    Invoice: invoices,
    InvoiceLineItem: lineItems,
    Receipt: receipts,
    ReceiptAllocation: allocations,
    LedgerEntry: ledgerEntries,
    ReminderRule: reminderRules,
    ReminderSent: remindersSent,
    Note: notes,
    PromiseToPay: promises,
    CallLog: callLogs,
    PortalToken: portalTokens,
    SavedView: savedViews,
    ActivityLog: activityLog,
    CronRun: cronRuns,
    InvoiceItemTemplate: itemTemplates,
  });

  console.log("\n=== FIRMS ===");
  console.table(await prisma.firm.findMany({ select: { name: true, frn: true, partnerName: true } }));

  console.log("\n=== CLIENT COMPANIES ===");
  console.table(await prisma.clientCompany.findMany({
    select: { displayName: true, tallyCompanyName: true, status: true, gstin: true },
  }));

  console.log("\n=== PARTY SUMMARY ===");
  const partyAgg = await prisma.party.aggregate({
    _sum: { closingBalance: true },
    _count: { _all: true },
    where: { closingBalance: { gt: 0 }, deletedAt: null },
  });
  console.log(`Open debtors: ${partyAgg._count._all}, sum closingBalance: ₹${Number(partyAgg._sum.closingBalance ?? 0).toLocaleString("en-IN")}`);

  console.log("\n=== TOP 5 PARTIES BY BALANCE ===");
  console.table(await prisma.party.findMany({
    where: { closingBalance: { gt: 0 }, deletedAt: null },
    orderBy: { closingBalance: "desc" },
    take: 5,
    select: { tallyLedgerName: true, closingBalance: true, email: true, phone: true },
  }));

  console.log("\n=== INVOICE STATUS BREAKDOWN ===");
  const invoiceByStatus = await prisma.invoice.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { outstandingAmount: true },
  });
  console.table(invoiceByStatus.map(r => ({
    status: r.status,
    count: r._count._all,
    outstanding: `₹${Number(r._sum.outstandingAmount ?? 0).toLocaleString("en-IN")}`,
  })));

  console.log("\n=== INVOICE AGE BUCKETS (OPEN ONLY) ===");
  const ageBreakdown = await prisma.invoice.groupBy({
    by: ["ageBucket"],
    where: { status: "OPEN", deletedAt: null },
    _count: { _all: true },
    _sum: { outstandingAmount: true },
  });
  console.table(ageBreakdown.map(r => ({
    bucket: r.ageBucket,
    count: r._count._all,
    outstanding: `₹${Number(r._sum.outstandingAmount ?? 0).toLocaleString("en-IN")}`,
  })));

  console.log("\n=== RECEIPT TOTALS ===");
  const receiptAgg = await prisma.receipt.aggregate({ _sum: { amount: true }, _count: { _all: true } });
  console.log(`Receipts: ${receiptAgg._count._all}, total: ₹${Number(receiptAgg._sum.amount ?? 0).toLocaleString("en-IN")}`);

  console.log("\n=== LEDGER ENTRIES BY VOUCHER TYPE ===");
  const vt = await prisma.ledgerEntry.groupBy({
    by: ["voucherType"],
    _count: { _all: true },
    orderBy: { _count: { voucherType: "desc" } },
  });
  console.table(vt.map(r => ({ voucherType: r.voucherType, rows: r._count._all })));

  console.log("\n=== REMINDERS SENT ===");
  const remByChannel = await prisma.reminderSent.groupBy({
    by: ["channel", "status"],
    _count: { _all: true },
  });
  console.table(remByChannel.map(r => ({ channel: r.channel, status: r.status, count: r._count._all })));

  console.log("\n=== LATEST CRON RUNS ===");
  console.table(await prisma.cronRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { job: true, status: true, rowsAffected: true, durationMs: true, startedAt: true },
  }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
