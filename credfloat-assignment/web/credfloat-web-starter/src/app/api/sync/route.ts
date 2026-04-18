import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const partySchema = z.object({
  company: z.string().min(1),
  tally_ledger_name: z.string().min(1),
  parent_group: z.string(),
  closing_balance: z.number(),
  mailing_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

const syncSchema = z.object({
  synced_at: z.string(),
  companies: z.array(z.object({ tally_name: z.string().min(1) })),
  parties: z.array(partySchema),
});

export async function POST(req: NextRequest) {
  // Bearer token auth
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }
  const token = authHeader.slice(7);
  if (!process.env.SYNC_API_KEY || token !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }

  // Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = syncSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { synced_at, companies, parties } = parsed.data;
  const syncedAt = new Date(synced_at);

  // V1: single-firm deployment. Resolve DPS & Co from the seed.
  const firm = await prisma.firm.findFirst({
    where: { name: process.env.SEED_FIRM_NAME ?? "DPS & Co" },
  });
  if (!firm) {
    return NextResponse.json(
      { error: "Firm not found. Run `npm run db:seed` first." },
      { status: 500 },
    );
  }

  // Upsert companies
  const companyNameToId = new Map<string, string>();
  for (const c of companies) {
    const company = await prisma.clientCompany.upsert({
      where: {
        firmId_tallyCompanyName: {
          firmId: firm.id,
          tallyCompanyName: c.tally_name,
        },
      },
      create: {
        firmId: firm.id,
        tallyCompanyName: c.tally_name,
        displayName: c.tally_name,
      },
      update: { updatedAt: new Date() },
    });
    companyNameToId.set(c.tally_name, company.id);
  }

  // Upsert parties
  let partyCount = 0;
  let skipped = 0;
  for (const p of parties) {
    const companyId = companyNameToId.get(p.company);
    if (!companyId) {
      skipped++;
      continue;
    }

    await prisma.party.upsert({
      where: {
        clientCompanyId_tallyLedgerName: {
          clientCompanyId: companyId,
          tallyLedgerName: p.tally_ledger_name,
        },
      },
      create: {
        clientCompanyId: companyId,
        tallyLedgerName: p.tally_ledger_name,
        parentGroup: p.parent_group,
        closingBalance: p.closing_balance,
        mailingName: p.mailing_name ?? null,
        address: p.address ?? null,
        phone: p.phone ?? null,
        email: p.email ?? null,
        lastSyncedAt: syncedAt,
      },
      update: {
        parentGroup: p.parent_group,
        closingBalance: p.closing_balance,
        mailingName: p.mailing_name ?? undefined,
        address: p.address ?? undefined,
        phone: p.phone ?? undefined,
        email: p.email ?? undefined,
        lastSyncedAt: syncedAt,
      },
    });
    partyCount++;
  }

  return NextResponse.json({
    synced: {
      companies: companies.length,
      parties: partyCount,
      skipped,
    },
    timestamp: new Date().toISOString(),
  });
}
