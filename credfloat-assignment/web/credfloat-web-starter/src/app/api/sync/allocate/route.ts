import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { allocateForParty } from "@/lib/allocation";

export const runtime = "nodejs";
// Each chunk of allocations runs serially with a small concurrency cap so a
// single chunk fits comfortably under Vercel's 60s function ceiling.
export const maxDuration = 60;

const bodySchema = z.object({
  partyIds: z.array(z.string().uuid()).min(1).max(50),
});

// Bearer auth uses the same SYNC_API_KEY as /api/sync.
function checkAuth(req: NextRequest): NextResponse | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or malformed Authorization header" },
      { status: 401 },
    );
  }
  const token = auth.slice(7);
  if (!process.env.SYNC_API_KEY || token !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ error: "Invalid sync token" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const fail = checkAuth(req);
  if (fail) return fail;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { partyIds } = parsed.data;
  const startedAt = Date.now();
  let invoicesTouched = 0;
  let advanceTotal = 0;

  // Same per-party allocation pattern as /api/sync. No bill-ref hints here —
  // /api/sync persists those before delegating, so a follow-up allocate call
  // would have nothing useful to pass anyway.
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
    const receiptsWithRefs = partyReceipts.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      receiptDate: r.receiptDate,
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
      { maxWait: 10_000, timeout: 55_000 },
    );
  }

  const ALLOC_CONCURRENCY = 10;
  for (let i = 0; i < partyIds.length; i += ALLOC_CONCURRENCY) {
    const batch = partyIds.slice(i, i + ALLOC_CONCURRENCY);
    const summaries = await Promise.all(batch.map(allocateOne));
    for (const s of summaries) {
      invoicesTouched += s.invoicesTouched;
      advanceTotal += s.advanceLeft;
    }
  }

  return NextResponse.json({
    allocated: {
      partiesProcessed: partyIds.length,
      invoicesUpdated: invoicesTouched,
      advanceTotal: Math.round(advanceTotal * 100) / 100,
    },
    durationMs: Date.now() - startedAt,
  });
}
