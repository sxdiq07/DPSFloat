/**
 * Demo-day one-shot setup. Idempotent.
 *
 *   npx tsx prisma/demo-setup.ts
 *
 * Sets DPS & Co's letterhead (FRN / partner name / M.No.) on the Firm
 * row, and drops the demo debtor's email + whatsapp onto VIP INSUSTRIES
 * LTD so live sends during the demo land on the presenter's own inbox
 * and phone.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_EMAIL = "sxdiqw@gmail.com";
const DEMO_WHATSAPP = "919820739445";

const FIRM_FRN = "002543N";
const FIRM_PARTNER_NAME = "CA Mohammed Rashid";
const FIRM_PARTNER_MNO = "438291";

async function main() {
  console.log("Demo-setup starting…\n");

  // 1. Letterhead on DPS & Co (there's only one firm; seed id is known).
  const firm = await prisma.firm.update({
    where: { id: "seed-firm-dpsandco" },
    data: {
      frn: FIRM_FRN,
      partnerName: FIRM_PARTNER_NAME,
      partnerMno: FIRM_PARTNER_MNO,
    },
  });
  console.log(`✓ Firm letterhead updated on ${firm.name}`);
  console.log(`  FRN           : ${firm.frn}`);
  console.log(`  Partner name  : ${firm.partnerName}`);
  console.log(`  Partner M.No. : ${firm.partnerMno}\n`);

  // 2. Demo debtor. The Send button only appears on invoice rows whose
  // party has email or whatsapp on file, so we target parties that
  // actually have OPEN bills — otherwise the invoice-tab demo has no
  // row to click. VIP INSUSTRIES LTD has a big ledger balance but zero
  // open bills (all in 'unbilled residual' / opening balance), so
  // seeding contacts on VIP wouldn't surface a Send button.
  const parties = await prisma.party.findMany({
    where: {
      invoices: {
        some: { status: "OPEN", outstandingAmount: { gt: 0 } },
      },
    },
    select: {
      id: true,
      tallyLedgerName: true,
      closingBalance: true,
      _count: { select: { invoices: { where: { status: "OPEN" } } } },
    },
    orderBy: { closingBalance: "desc" },
    take: 5,
  });

  if (parties.length === 0) {
    console.warn(
      "⚠ No parties have open invoices. Run the Tally connector first.",
    );
  } else {
    console.log(
      `Top ${parties.length} parties with open invoices (by ledger balance):`,
    );
    for (const p of parties) {
      console.log(
        `  · ${p.tallyLedgerName} — ₹${Number(p.closingBalance).toLocaleString("en-IN")} · ${p._count.invoices} open bills`,
      );
    }
    console.log(`\nSeeding contacts on all ${parties.length}:\n`);

    for (const p of parties) {
      await prisma.party.update({
        where: { id: p.id },
        data: { email: DEMO_EMAIL, whatsappNumber: DEMO_WHATSAPP },
      });
      console.log(`✓ ${p.tallyLedgerName}`);
    }
    console.log(`\n  email         : ${DEMO_EMAIL}`);
    console.log(`  whatsappNumber: ${DEMO_WHATSAPP}`);
  }

  console.log("\nDone. Refresh the browser to see the debtor's contacts wired up.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("demo-setup failed:", e);
  await prisma.$disconnect();
  process.exit(1);
});
