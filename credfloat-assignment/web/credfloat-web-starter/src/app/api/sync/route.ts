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
  whatsapp_number: z.string().nullable().optional(),
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

  const startedAt = Date.now();

  // Batch company upserts in a single transaction.
  // Empty `update: {}` lets Prisma auto-touch `updatedAt` via @updatedAt.
  const upsertedCompanies = await prisma.$transaction(
    companies.map((c) =>
      prisma.clientCompany.upsert({
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
        update: {},
      }),
    ),
    { timeout: 60_000 },
  );
  const companyNameToId = new Map<string, string>(
    upsertedCompanies.map((c) => [c.tallyCompanyName, c.id]),
  );

  // Batch party upserts in chunks. One big transaction for thousands of rows
  // ties up a pooler connection for longer than needed and risks timing out;
  // chunks of 50 strike a balance between round-trip reduction and latency.
  // `?? undefined` on update branches is intentional: null-from-sync leaves
  // the stored value alone, so incomplete syncs never clobber good data.
  const CHUNK = 50;
  let partyCount = 0;
  let skipped = 0;
  const partyOps: ReturnType<typeof prisma.party.upsert>[] = [];
  for (const p of parties) {
    const companyId = companyNameToId.get(p.company);
    if (!companyId) {
      skipped++;
      continue;
    }
    partyOps.push(
      prisma.party.upsert({
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
          whatsappNumber: p.whatsapp_number ?? null,
          lastSyncedAt: syncedAt,
        },
        update: {
          parentGroup: p.parent_group,
          closingBalance: p.closing_balance,
          mailingName: p.mailing_name ?? undefined,
          address: p.address ?? undefined,
          phone: p.phone ?? undefined,
          email: p.email ?? undefined,
          whatsappNumber: p.whatsapp_number ?? undefined,
          lastSyncedAt: syncedAt,
        },
      }),
    );
    partyCount++;
  }

  for (let i = 0; i < partyOps.length; i += CHUNK) {
    await prisma.$transaction(partyOps.slice(i, i + CHUNK), {
      timeout: 60_000,
    });
  }

  const durationMs = Date.now() - startedAt;

  return NextResponse.json({
    synced: {
      companies: companies.length,
      parties: partyCount,
      skipped,
    },
    durationMs,
    timestamp: new Date().toISOString(),
  });
}
