/**
 * Wipe all Receipt + ReceiptAllocation rows so the next Tally sync
 * rebuilds them from scratch. Also zeroes Party.advanceAmount and
 * recomputes Invoice.outstandingAmount to match originalAmount for
 * every OPEN invoice.
 *
 * Useful when the connector's voucher-filter rules have changed and
 * the DB still carries rows produced by the old rules — an upsert-only
 * re-sync won't purge them.
 *
 * Run with:
 *   npx tsx prisma/reset-receipts.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Resetting receipt / allocation / derived state ...");

  const [allocs, receipts, invoices, parties] = await prisma.$transaction([
    prisma.receiptAllocation.deleteMany({}),
    prisma.receipt.deleteMany({}),
    prisma.invoice.updateMany({
      data: {
        // Can't reference originalAmount in updateMany → use raw next.
      },
    }),
    prisma.party.updateMany({
      data: { advanceAmount: 0 },
    }),
  ]);

  // Invoice.outstandingAmount = Invoice.originalAmount everywhere, and
  // status back to OPEN. The allocation engine will re-derive from
  // whatever the next sync brings.
  const resetInvoices = await prisma.$executeRaw`
    UPDATE "Invoice"
    SET "outstandingAmount" = "originalAmount",
        "status" = 'OPEN',
        "updatedAt" = NOW()
    WHERE "status" IN ('OPEN', 'PAID')
  `;

  console.log(`  Deleted allocations: ${allocs.count}`);
  console.log(`  Deleted receipts   : ${receipts.count}`);
  console.log(`  Parties reset      : ${parties.count}`);
  console.log(`  Invoices reset     : ${resetInvoices}`);
  console.log(
    `\nDone. Run \`python tally_connector.py\` next to rebuild from Tally.`,
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
