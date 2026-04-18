import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
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

  // Bulk-upsert parties via raw INSERT ... ON CONFLICT DO UPDATE.
  // One round-trip per chunk instead of one per party — ~10x faster than
  // Prisma's per-row upsert over a Tokyo pooler. COALESCE on the UPDATE
  // branch preserves stored values when the incoming sync has NULL, so
  // incomplete syncs never clobber good contact data.
  const CHUNK = 200;
  let partyCount = 0;
  let skipped = 0;
  type PartyRow = {
    id: string;
    clientCompanyId: string;
    tallyLedgerName: string;
    parentGroup: string;
    mailingName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    whatsappNumber: string | null;
    closingBalance: number;
  };
  const rows: PartyRow[] = [];
  for (const p of parties) {
    const companyId = companyNameToId.get(p.company);
    if (!companyId) {
      skipped++;
      continue;
    }
    rows.push({
      id: randomUUID(),
      clientCompanyId: companyId,
      tallyLedgerName: p.tally_ledger_name,
      parentGroup: p.parent_group,
      mailingName: p.mailing_name ?? null,
      address: p.address ?? null,
      phone: p.phone ?? null,
      email: p.email ?? null,
      whatsappNumber: p.whatsapp_number ?? null,
      closingBalance: p.closing_balance,
    });
    partyCount++;
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map(
      (r) => Prisma.sql`(
        ${r.id},
        ${r.clientCompanyId},
        ${r.tallyLedgerName},
        ${r.parentGroup},
        ${r.mailingName},
        ${r.address},
        ${r.phone},
        ${r.email},
        ${r.whatsappNumber},
        ${r.closingBalance},
        ${syncedAt},
        NOW(),
        NOW()
      )`,
    );
    await prisma.$executeRaw`
      INSERT INTO "Party" (
        "id",
        "clientCompanyId",
        "tallyLedgerName",
        "parentGroup",
        "mailingName",
        "address",
        "phone",
        "email",
        "whatsappNumber",
        "closingBalance",
        "lastSyncedAt",
        "createdAt",
        "updatedAt"
      )
      VALUES ${Prisma.join(values, ",")}
      ON CONFLICT ("clientCompanyId", "tallyLedgerName") DO UPDATE SET
        "parentGroup" = EXCLUDED."parentGroup",
        "closingBalance" = EXCLUDED."closingBalance",
        "mailingName" = COALESCE(EXCLUDED."mailingName", "Party"."mailingName"),
        "address" = COALESCE(EXCLUDED."address", "Party"."address"),
        "phone" = COALESCE(EXCLUDED."phone", "Party"."phone"),
        "email" = COALESCE(EXCLUDED."email", "Party"."email"),
        "whatsappNumber" = COALESCE(EXCLUDED."whatsappNumber", "Party"."whatsappNumber"),
        "lastSyncedAt" = EXCLUDED."lastSyncedAt",
        "updatedAt" = NOW()
    `;
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
