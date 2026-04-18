import { PrismaClient } from "@prisma/client";
import { toZonedTime } from "date-fns-tz";

const prisma = new PrismaClient();

const IST_TZ = "Asia/Kolkata";

function istToday(): Date {
  const d = toZonedTime(new Date(), IST_TZ);
  d.setHours(0, 0, 0, 0);
  return d;
}

function istDaysAgo(days: number): Date {
  const d = istToday();
  d.setDate(d.getDate() - days);
  return d;
}

async function main() {
  const firm = await prisma.firm.findFirst({ where: { name: "DPS & Co" } });
  if (!firm) throw new Error("Run `npx prisma db seed` first to create the firm.");

  const clientTallyName = "Acme Traders Pvt Ltd";
  const client = await prisma.clientCompany.upsert({
    where: {
      firmId_tallyCompanyName: {
        firmId: firm.id,
        tallyCompanyName: clientTallyName,
      },
    },
    create: {
      firmId: firm.id,
      tallyCompanyName: clientTallyName,
      displayName: clientTallyName,
    },
    update: { displayName: clientTallyName },
  });

  const partyLedgerName = "XYZ Distributors";
  const syncedAt = new Date();
  const party = await prisma.party.upsert({
    where: {
      clientCompanyId_tallyLedgerName: {
        clientCompanyId: client.id,
        tallyLedgerName: partyLedgerName,
      },
    },
    create: {
      clientCompanyId: client.id,
      tallyLedgerName: partyLedgerName,
      mailingName: partyLedgerName,
      parentGroup: "Sundry Debtors",
      closingBalance: 520000,
      email: "test@example.com",
      whatsappNumber: "+919999999999",
      lastSyncedAt: syncedAt,
    },
    update: {
      closingBalance: 520000,
      email: "test@example.com",
      whatsappNumber: "+919999999999",
      lastSyncedAt: syncedAt,
    },
  });

  const invoices = [
    {
      billRef: "INV-DEMO-001",
      billDate: istDaysAgo(30),
      dueDate: istToday(),
      outstanding: 50000,
    },
    {
      billRef: "INV-DEMO-002",
      billDate: istDaysAgo(45),
      dueDate: istDaysAgo(15),
      outstanding: 120000,
    },
    {
      billRef: "INV-DEMO-003",
      billDate: istDaysAgo(90),
      dueDate: istDaysAgo(60),
      outstanding: 350000,
    },
  ];

  for (const inv of invoices) {
    await prisma.invoice.upsert({
      where: {
        clientCompanyId_partyId_billRef: {
          clientCompanyId: client.id,
          partyId: party.id,
          billRef: inv.billRef,
        },
      },
      create: {
        clientCompanyId: client.id,
        partyId: party.id,
        billRef: inv.billRef,
        billDate: inv.billDate,
        dueDate: inv.dueDate,
        originalAmount: inv.outstanding,
        outstandingAmount: inv.outstanding,
        status: "OPEN",
        lastSyncedAt: syncedAt,
      },
      update: {
        billDate: inv.billDate,
        dueDate: inv.dueDate,
        originalAmount: inv.outstanding,
        outstandingAmount: inv.outstanding,
        status: "OPEN",
        lastSyncedAt: syncedAt,
      },
    });
  }

  const existingRule = await prisma.reminderRule.findFirst({
    where: { clientCompanyId: client.id },
  });
  if (existingRule) {
    await prisma.reminderRule.update({
      where: { id: existingRule.id },
      data: {
        enabled: true,
        triggerDays: [-3, 0, 7, 14, 30],
        channels: ["EMAIL", "WHATSAPP"],
      },
    });
  } else {
    await prisma.reminderRule.create({
      data: {
        clientCompanyId: client.id,
        enabled: true,
        triggerDays: [-3, 0, 7, 14, 30],
        channels: ["EMAIL", "WHATSAPP"],
      },
    });
  }

  console.log(`✓ Client: ${client.displayName}`);
  console.log(`✓ Party: ${party.tallyLedgerName} (email=${party.email}, whatsapp=${party.whatsappNumber})`);
  console.log(`✓ Invoices: 3 (due today, 15d overdue, 60d overdue)`);
  console.log(`✓ ReminderRule: EMAIL+WHATSAPP, triggerDays=[-3,0,7,14,30]`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
