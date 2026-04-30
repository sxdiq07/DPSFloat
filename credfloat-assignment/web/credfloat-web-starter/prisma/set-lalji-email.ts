/**
 * One-shot: set LAL JI STORE's email to the Resend-authorised inbox
 * so the live email demo actually lands. Safe to re-run.
 *
 *   npx tsx prisma/set-lalji-email.ts
 */
import { PrismaClient } from "@prisma/client";

const TARGET_EMAIL = "sxdiqw@gmail.com";
const prisma = new PrismaClient();

async function main() {
  const matches = await prisma.party.findMany({
    where: {
      tallyLedgerName: { contains: "LAL JI", mode: "insensitive" },
      deletedAt: null,
    },
    select: {
      id: true,
      tallyLedgerName: true,
      mailingName: true,
      email: true,
      clientCompany: { select: { displayName: true } },
    },
  });

  if (matches.length === 0) {
    console.log("No party matches 'LAL JI'. Nothing to update.");
    return;
  }

  console.log(`Matched ${matches.length} party row(s):`);
  for (const p of matches) {
    console.log(
      `  - ${p.tallyLedgerName}  [${p.clientCompany.displayName}]  current email=${p.email ?? "(none)"}`,
    );
  }

  const result = await prisma.party.updateMany({
    where: { id: { in: matches.map((p) => p.id) } },
    data: { email: TARGET_EMAIL },
  });

  console.log(
    `\nUpdated ${result.count} row(s) — email set to ${TARGET_EMAIL}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
