import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const firmName = process.env.SEED_FIRM_NAME ?? "DPS & Co";
  const email = process.env.SEED_DEMO_EMAIL ?? "demo@dpsandco.in";
  const password = process.env.SEED_DEMO_PASSWORD ?? "dps2026";

  // Create the firm (idempotent)
  const firm = await prisma.firm.upsert({
    where: { id: "seed-firm-dpsandco" },
    create: { id: "seed-firm-dpsandco", name: firmName },
    update: { name: firmName },
  });

  // Create the demo user
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.firmStaff.upsert({
    where: { email },
    create: {
      email,
      name: "Demo Partner",
      passwordHash,
      role: "PARTNER",
      firmId: firm.id,
    },
    update: { passwordHash, firmId: firm.id },
  });

  console.log(`✓ Seeded firm: ${firm.name} (id: ${firm.id})`);
  console.log(`✓ Seeded demo user: ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
