import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allocateForParty } from "@/lib/allocation";

export const runtime = "nodejs";

const partySchema = z.object({
  company: z.string().min(1),
  tally_ledger_name: z.string().min(1),
  parent_group: z.string(),
  closing_balance: z.number(),
  opening_balance: z.number().optional().default(0),
  mailing_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  whatsapp_number: z.string().nullable().optional(),
});

const ledgerEntrySchema = z.object({
  company: z.string().min(1),
  tally_ledger_name: z.string().min(1),
  voucher_date: z.string().min(1),
  voucher_type: z.enum([
    "SALES",
    "PURCHASE",
    "RECEIPT",
    "PAYMENT",
    "JOURNAL",
    "CONTRA",
    "CREDIT_NOTE",
    "DEBIT_NOTE",
    "STOCK_JOURNAL",
    "OTHER",
  ]),
  voucher_ref: z.string().min(1),
  counterparty: z.string().optional().default(""),
  narration: z.string().nullable().optional(),
  debit: z.number(),
  credit: z.number(),
});

const invoiceSchema = z.object({
  company: z.string().min(1),
  tally_ledger_name: z.string().min(1),
  bill_ref: z.string().min(1),
  bill_date: z.string().min(1),
  due_date: z.string().nullable().optional(),
  original_amount: z.number(),
  outstanding_amount: z.number(),
});

const receiptSchema = z.object({
  company: z.string().min(1),
  tally_ledger_name: z.string().min(1),
  voucher_ref: z.string().min(1),
  receipt_date: z.string().min(1),
  amount: z.number(),
  // Tally's BILLALLOCATIONS on the receipt voucher — when Tally has
  // already knocked the payment off specific bills, these land here so
  // the allocation engine can honour the bill-wise source of truth.
  bill_refs: z
    .array(z.object({ bill_ref: z.string(), amount: z.number() }))
    .optional()
    .default([]),
});

const syncSchema = z.object({
  synced_at: z.string(),
  companies: z.array(z.object({ tally_name: z.string().min(1) })),
  parties: z.array(partySchema),
  invoices: z.array(invoiceSchema).optional().default([]),
  receipts: z.array(receiptSchema).optional().default([]),
  day_book: z.array(ledgerEntrySchema).optional().default([]),
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

  const { synced_at, companies, parties, invoices, receipts, day_book } = parsed.data;
  const syncedAt = new Date(synced_at);

  // Prefer the explicit SEED_FIRM_ID env var (stable across renames); fall
  // back to lookup by name for first-run bootstrapping. Fragile if anyone
  // renames DPS & Co or adds a second firm before SEED_FIRM_ID is set.
  const firm = process.env.SEED_FIRM_ID
    ? await prisma.firm.findUnique({ where: { id: process.env.SEED_FIRM_ID } })
    : await prisma.firm.findFirst({
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
  // Interactive form is used so we can raise the timeout above Prisma's
  // 5s default — Supabase's Mumbai pooler can stall on cold starts.
  const upsertedCompanies = await prisma.$transaction(
    async (tx) =>
      Promise.all(
        companies.map((c) =>
          tx.clientCompany.upsert({
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
    openingBalance: number;
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
      openingBalance: p.opening_balance ?? 0,
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
        ${r.openingBalance},
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
        "openingBalance",
        "lastSyncedAt",
        "createdAt",
        "updatedAt"
      )
      VALUES ${Prisma.join(values, ",")}
      ON CONFLICT ("clientCompanyId", "tallyLedgerName") DO UPDATE SET
        "parentGroup" = EXCLUDED."parentGroup",
        "closingBalance" = EXCLUDED."closingBalance",
        "openingBalance" = EXCLUDED."openingBalance",
        "mailingName" = COALESCE(EXCLUDED."mailingName", "Party"."mailingName"),
        "address" = COALESCE(EXCLUDED."address", "Party"."address"),
        "phone" = COALESCE(EXCLUDED."phone", "Party"."phone"),
        "email" = COALESCE(EXCLUDED."email", "Party"."email"),
        "whatsappNumber" = COALESCE(EXCLUDED."whatsappNumber", "Party"."whatsappNumber"),
        "lastSyncedAt" = EXCLUDED."lastSyncedAt",
        "updatedAt" = NOW()
    `;
  }

  // --- Bill-wise invoices (bulk upsert, same pattern as parties) ---
  let invoiceCount = 0;
  let invoiceSkipped = 0;

  if (invoices.length > 0) {
    // Need partyId by (clientCompanyId, tallyLedgerName) — one query covers
    // every incoming invoice. No N+1.
    const companyIds = [...companyNameToId.values()];
    const existingParties = await prisma.party.findMany({
      where: { clientCompanyId: { in: companyIds } },
      select: { id: true, clientCompanyId: true, tallyLedgerName: true },
    });
    const partyKey = (clientCompanyId: string, ledger: string) =>
      `${clientCompanyId}::${ledger}`;
    const partyIdByKey = new Map(
      existingParties.map((p) => [
        partyKey(p.clientCompanyId, p.tallyLedgerName),
        p.id,
      ]),
    );

    // Invoices often reference debtor ledgers that weren't surfaced by the
    // ODBC Sundry-Debtors filter (sub-groups, non-standard groupings). Auto-
    // create minimal Party stubs for any unknown ledger so we don't drop
    // bills on the floor. Real contact fields land on the next ODBC sync
    // that happens to include these ledgers.
    const unknownParties = new Map<string, { companyId: string; ledger: string }>();
    for (const inv of invoices) {
      const companyId = companyNameToId.get(inv.company);
      if (!companyId) continue;
      const key = partyKey(companyId, inv.tally_ledger_name);
      if (!partyIdByKey.has(key) && !unknownParties.has(key)) {
        unknownParties.set(key, {
          companyId,
          ledger: inv.tally_ledger_name,
        });
      }
    }
    if (unknownParties.size > 0) {
      const stubRows = [...unknownParties.values()].map((u) => ({
        id: randomUUID(),
        clientCompanyId: u.companyId,
        tallyLedgerName: u.ledger,
      }));
      for (let i = 0; i < stubRows.length; i += CHUNK) {
        const chunk = stubRows.slice(i, i + CHUNK);
        const values = chunk.map(
          (r) => Prisma.sql`(
            ${r.id},
            ${r.clientCompanyId},
            ${r.tallyLedgerName},
            'Sundry Debtors',
            0,
            ${syncedAt},
            NOW(),
            NOW()
          )`,
        );
        await prisma.$executeRaw`
          INSERT INTO "Party" (
            "id", "clientCompanyId", "tallyLedgerName",
            "parentGroup", "closingBalance",
            "lastSyncedAt", "createdAt", "updatedAt"
          )
          VALUES ${Prisma.join(values, ",")}
          ON CONFLICT ("clientCompanyId", "tallyLedgerName") DO NOTHING
        `;
      }
      const refreshed = await prisma.party.findMany({
        where: { clientCompanyId: { in: companyIds } },
        select: { id: true, clientCompanyId: true, tallyLedgerName: true },
      });
      partyIdByKey.clear();
      for (const p of refreshed) {
        partyIdByKey.set(partyKey(p.clientCompanyId, p.tallyLedgerName), p.id);
      }
    }

    type InvoiceRow = {
      id: string;
      clientCompanyId: string;
      partyId: string;
      billRef: string;
      billDate: Date;
      dueDate: Date | null;
      originalAmount: number;
      outstandingAmount: number;
    };
    const invoiceRows: InvoiceRow[] = [];

    for (const inv of invoices) {
      const companyId = companyNameToId.get(inv.company);
      if (!companyId) {
        invoiceSkipped++;
        continue;
      }
      const partyId = partyIdByKey.get(
        partyKey(companyId, inv.tally_ledger_name),
      );
      if (!partyId) {
        // Invoice references a debtor we haven't seen yet — skip gracefully.
        // Next sync will include the party and the retry will land.
        invoiceSkipped++;
        continue;
      }
      invoiceRows.push({
        id: randomUUID(),
        clientCompanyId: companyId,
        partyId,
        billRef: inv.bill_ref,
        billDate: new Date(inv.bill_date),
        dueDate: inv.due_date ? new Date(inv.due_date) : null,
        originalAmount: inv.original_amount,
        outstandingAmount: inv.outstanding_amount,
      });
      invoiceCount++;
    }

    for (let i = 0; i < invoiceRows.length; i += CHUNK) {
      const chunk = invoiceRows.slice(i, i + CHUNK);
      const values = chunk.map(
        (r) => Prisma.sql`(
          ${r.id},
          ${r.clientCompanyId},
          ${r.partyId},
          ${r.billRef},
          ${r.billDate},
          ${r.dueDate},
          ${r.originalAmount},
          ${r.outstandingAmount},
          'OPEN'::"InvoiceStatus",
          'CURRENT'::"AgeBucket",
          ${syncedAt},
          NOW(),
          NOW()
        )`,
      );
      await prisma.$executeRaw`
        INSERT INTO "Invoice" (
          "id",
          "clientCompanyId",
          "partyId",
          "billRef",
          "billDate",
          "dueDate",
          "originalAmount",
          "outstandingAmount",
          "status",
          "ageBucket",
          "lastSyncedAt",
          "createdAt",
          "updatedAt"
        )
        VALUES ${Prisma.join(values, ",")}
        ON CONFLICT ("clientCompanyId", "partyId", "billRef") DO UPDATE SET
          "billDate" = EXCLUDED."billDate",
          "dueDate" = EXCLUDED."dueDate",
          "originalAmount" = EXCLUDED."originalAmount",
          "outstandingAmount" = EXCLUDED."outstandingAmount",
          "lastSyncedAt" = EXCLUDED."lastSyncedAt",
          "updatedAt" = NOW()
      `;
    }
  }

  // --- Receipts (bulk upsert, same pattern as invoices) ---
  let receiptCount = 0;
  let receiptSkipped = 0;
  // partyId -> receiptId -> bill-wise allocations claimed by Tally on this
  // receipt voucher. Held in memory and passed into the allocation engine.
  const receiptBillRefsByParty = new Map<
    string,
    Map<string, Array<{ billRef: string; amount: number }>>
  >();

  if (receipts.length > 0) {
    // Re-resolve (companyId, ledgerName) -> partyId the same way as the
    // invoice path. Reuses `companyNameToId` from earlier in the route.
    const companyIds = [...companyNameToId.values()];
    const existingParties = await prisma.party.findMany({
      where: { clientCompanyId: { in: companyIds } },
      select: { id: true, clientCompanyId: true, tallyLedgerName: true },
    });
    const partyKey = (cid: string, l: string) => `${cid}::${l}`;
    const partyIdByKey = new Map(
      existingParties.map((p) => [partyKey(p.clientCompanyId, p.tallyLedgerName), p.id]),
    );

    type ReceiptRow = {
      id: string;
      clientCompanyId: string;
      partyId: string;
      voucherRef: string;
      receiptDate: Date;
      amount: number;
    };
    // Dedupe on (clientCompanyId, voucherRef) — the DB has a unique
    // constraint there, and Postgres rejects an INSERT ... ON CONFLICT
    // DO UPDATE that proposes to touch the same conflict key twice in
    // one statement. Keep the last occurrence — it wins the upsert.
    const receiptByKey = new Map<string, ReceiptRow>();

    for (const rec of receipts) {
      const companyId = companyNameToId.get(rec.company);
      if (!companyId) {
        receiptSkipped++;
        continue;
      }
      const partyId = partyIdByKey.get(
        partyKey(companyId, rec.tally_ledger_name),
      );
      if (!partyId) {
        receiptSkipped++;
        continue;
      }
      const dedupeKey = `${companyId}::${rec.voucher_ref}`;
      receiptByKey.set(dedupeKey, {
        id: randomUUID(),
        clientCompanyId: companyId,
        partyId,
        voucherRef: rec.voucher_ref,
        receiptDate: new Date(rec.receipt_date),
        amount: rec.amount,
      });
    }
    const receiptRows: ReceiptRow[] = [...receiptByKey.values()];
    receiptCount = receiptRows.length;
    receiptSkipped = receipts.length - receiptCount;

    for (let i = 0; i < receiptRows.length; i += CHUNK) {
      const chunk = receiptRows.slice(i, i + CHUNK);
      const values = chunk.map(
        (r) => Prisma.sql`(
          ${r.id},
          ${r.clientCompanyId},
          ${r.partyId},
          ${r.voucherRef},
          ${r.receiptDate},
          ${r.amount},
          ${syncedAt},
          NOW()
        )`,
      );
      await prisma.$executeRaw`
        INSERT INTO "Receipt" (
          "id",
          "clientCompanyId",
          "partyId",
          "voucherRef",
          "receiptDate",
          "amount",
          "lastSyncedAt",
          "createdAt"
        )
        VALUES ${Prisma.join(values, ",")}
        ON CONFLICT ("clientCompanyId", "voucherRef") DO UPDATE SET
          "receiptDate" = EXCLUDED."receiptDate",
          "amount" = EXCLUDED."amount",
          "lastSyncedAt" = EXCLUDED."lastSyncedAt"
      `;
    }

    // Resolve upserted receipt ids (by unique voucherRef) so we can key
    // bill-refs for the allocation engine.
    const voucherRefs = receiptRows.map((r) => r.voucherRef);
    const storedReceipts = await prisma.receipt.findMany({
      where: {
        clientCompanyId: { in: companyIds },
        voucherRef: { in: voucherRefs },
      },
      select: { id: true, partyId: true, clientCompanyId: true, voucherRef: true },
    });
    const receiptIdByKey = new Map(
      storedReceipts.map((r) => [`${r.clientCompanyId}::${r.voucherRef}`, r.id]),
    );

    for (const rec of receipts) {
      const companyId = companyNameToId.get(rec.company);
      if (!companyId) continue;
      const partyId = partyIdByKey.get(
        partyKey(companyId, rec.tally_ledger_name),
      );
      if (!partyId) continue;
      const receiptId = receiptIdByKey.get(`${companyId}::${rec.voucher_ref}`);
      if (!receiptId) continue;
      if (!rec.bill_refs || rec.bill_refs.length === 0) continue;
      const perParty =
        receiptBillRefsByParty.get(partyId) ??
        new Map<string, Array<{ billRef: string; amount: number }>>();
      perParty.set(
        receiptId,
        rec.bill_refs.map((b) => ({ billRef: b.bill_ref, amount: b.amount })),
      );
      receiptBillRefsByParty.set(partyId, perParty);
    }
  }

  // --- Allocation engine ---
  // Run per party that had either invoices or receipts in this sync. A
  // party with no receipts doesn't need a pass (outstandingAmount stays
  // at originalAmount), but a party that had invoices upserted with a
  // changed originalAmount does, so we include both.
  const dirtyPartyIds = new Set<string>();
  if (invoices.length > 0 || receipts.length > 0) {
    const companyIds = [...companyNameToId.values()];
    const touchedLedgers = new Set<string>();
    for (const inv of invoices) touchedLedgers.add(`${inv.company}::${inv.tally_ledger_name}`);
    for (const rec of receipts) touchedLedgers.add(`${rec.company}::${rec.tally_ledger_name}`);
    const partiesTouched = await prisma.party.findMany({
      where: { clientCompanyId: { in: companyIds } },
      select: { id: true, clientCompanyId: true, tallyLedgerName: true },
    });
    const companyIdToName = new Map(
      [...companyNameToId.entries()].map(([n, id]) => [id, n]),
    );
    for (const p of partiesTouched) {
      const cname = companyIdToName.get(p.clientCompanyId);
      if (!cname) continue;
      if (touchedLedgers.has(`${cname}::${p.tallyLedgerName}`)) {
        dirtyPartyIds.add(p.id);
      }
    }
  }

  // Run per-party allocations in parallel with a concurrency cap. Each
  // party operates on its own data (its own invoices + receipts), so
  // parallelism is safe. Capped at 10 in-flight — higher gets throttled
  // by Supabase's pooler connection limit and starts returning errors.
  let allocInvoicesTouched = 0;
  let allocAdvanceTotal = 0;
  const ALLOC_CONCURRENCY = 10;

  async function allocateOne(partyId: string) {
    const [partyInvoices, partyReceipts, party] = await Promise.all([
      prisma.invoice.findMany({
        where: { partyId },
        select: {
          id: true,
          billRef: true,
          billDate: true,
          originalAmount: true,
          outstandingAmount: true,
        },
        orderBy: { billDate: "asc" },
      }),
      prisma.receipt.findMany({
        where: { partyId },
        select: { id: true, amount: true, receiptDate: true },
        orderBy: { receiptDate: "asc" },
      }),
      prisma.party.findUnique({
        where: { id: partyId },
        select: { closingBalance: true },
      }),
    ]);
    const billRefMap = receiptBillRefsByParty.get(partyId);
    const receiptsWithRefs = partyReceipts.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      receiptDate: r.receiptDate,
      billRefs: billRefMap?.get(r.id),
    }));
    const closing = Number(party?.closingBalance ?? 0);
    return prisma.$transaction(
      async (tx) =>
        allocateForParty(
          tx,
          partyId,
          partyInvoices,
          receiptsWithRefs,
          closing,
        ),
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  const dirtyList = [...dirtyPartyIds];
  for (let i = 0; i < dirtyList.length; i += ALLOC_CONCURRENCY) {
    const batch = dirtyList.slice(i, i + ALLOC_CONCURRENCY);
    const summaries = await Promise.all(batch.map(allocateOne));
    for (const s of summaries) {
      allocInvoicesTouched += s.invoicesTouched;
      allocAdvanceTotal += s.advanceLeft;
    }
  }

  // --- Day Book upsert ---
  // Dedup-and-bulk-insert the LedgerEntry rows. Unique index
  // (clientCompanyId, voucherRef, voucherType, partyId, counterparty)
  // makes the upsert idempotent — a second sync with the same entries
  // becomes a no-op UPDATE.
  let ledgerEntryCount = 0;
  let ledgerEntrySkipped = 0;
  if (day_book.length > 0) {
    const companyIds = [...companyNameToId.values()];
    const allParties = await prisma.party.findMany({
      where: { clientCompanyId: { in: companyIds } },
      select: { id: true, clientCompanyId: true, tallyLedgerName: true },
    });
    const partyIdByKey = new Map(
      allParties.map((p) => [
        `${p.clientCompanyId}::${p.tallyLedgerName}`,
        p.id,
      ]),
    );

    type LedgerRow = {
      id: string;
      partyId: string;
      clientCompanyId: string;
      voucherDate: Date;
      voucherType: string;
      voucherRef: string;
      counterparty: string;
      narration: string | null;
      debit: number;
      credit: number;
    };
    // Dedup in-memory on the same key the DB unique index uses — prevents
    // "ON CONFLICT cannot affect the same row twice" when Tally exports
    // the same entry more than once in a single voucher listing.
    const byKey = new Map<string, LedgerRow>();
    for (const e of day_book) {
      const companyId = companyNameToId.get(e.company);
      if (!companyId) {
        ledgerEntrySkipped++;
        continue;
      }
      const partyId = partyIdByKey.get(
        `${companyId}::${e.tally_ledger_name}`,
      );
      if (!partyId) {
        ledgerEntrySkipped++;
        continue;
      }
      const key = `${companyId}::${e.voucher_ref}::${e.voucher_type}::${partyId}::${e.counterparty ?? ""}`;
      byKey.set(key, {
        id: randomUUID(),
        partyId,
        clientCompanyId: companyId,
        voucherDate: new Date(e.voucher_date),
        voucherType: e.voucher_type,
        voucherRef: e.voucher_ref,
        counterparty: e.counterparty ?? "",
        narration: e.narration ?? null,
        debit: e.debit,
        credit: e.credit,
      });
    }
    const ledgerRows = [...byKey.values()];
    ledgerEntryCount = ledgerRows.length;

    for (let i = 0; i < ledgerRows.length; i += CHUNK) {
      const chunk = ledgerRows.slice(i, i + CHUNK);
      const values = chunk.map(
        (r) => Prisma.sql`(
          ${r.id},
          ${r.partyId},
          ${r.clientCompanyId},
          ${r.voucherDate},
          ${r.voucherType}::"VoucherType",
          ${r.voucherRef},
          ${r.counterparty},
          ${r.narration},
          ${r.debit},
          ${r.credit},
          ${syncedAt},
          NOW()
        )`,
      );
      await prisma.$executeRaw`
        INSERT INTO "LedgerEntry" (
          "id",
          "partyId",
          "clientCompanyId",
          "voucherDate",
          "voucherType",
          "voucherRef",
          "counterparty",
          "narration",
          "debit",
          "credit",
          "lastSyncedAt",
          "createdAt"
        )
        VALUES ${Prisma.join(values, ",")}
        ON CONFLICT ("clientCompanyId", "voucherRef", "voucherType", "partyId", "counterparty")
        DO UPDATE SET
          "voucherDate" = EXCLUDED."voucherDate",
          "narration" = EXCLUDED."narration",
          "debit" = EXCLUDED."debit",
          "credit" = EXCLUDED."credit",
          "lastSyncedAt" = EXCLUDED."lastSyncedAt"
      `;
    }
  }

  const durationMs = Date.now() - startedAt;

  return NextResponse.json({
    synced: {
      companies: companies.length,
      parties: partyCount,
      invoices: invoiceCount,
      receipts: receiptCount,
      ledgerEntries: ledgerEntryCount,
      skipped:
        skipped + invoiceSkipped + receiptSkipped + ledgerEntrySkipped,
      allocation: {
        partiesProcessed: dirtyPartyIds.size,
        invoicesUpdated: allocInvoicesTouched,
        advanceTotal: Math.round(allocAdvanceTotal * 100) / 100,
      },
    },
    durationMs,
    timestamp: new Date().toISOString(),
  });
}
