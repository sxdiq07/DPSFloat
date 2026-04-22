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

  // 2. Demo debtor. Tally's ledger spells it "VIP INSUSTRIES LTD" (sic).
  const parties = await prisma.party.findMany({
    where: { tallyLedgerName: { contains: "VIP", mode: "insensitive" } },
    select: { id: true, tallyLedgerName: true },
  });
  if (parties.length === 0) {
    console.warn(
      "⚠ No party matched 'VIP' — has the Tally sync been run? Skipping debtor update.",
    );
  } else if (parties.length > 1) {
    console.warn(
      `⚠ ${parties.length} parties matched 'VIP'. Updating all of them — narrow the filter if that's wrong.`,
    );
  }

  for (const p of parties) {
    await prisma.party.update({
      where: { id: p.id },
      data: { email: DEMO_EMAIL, whatsappNumber: DEMO_WHATSAPP },
    });
    console.log(`✓ ${p.tallyLedgerName}`);
    console.log(`  email         : ${DEMO_EMAIL}`);
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
