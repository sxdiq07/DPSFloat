import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight ping for the connector tray app. Same Bearer token as /api/sync.
// Returns { ok, lastSyncAt } so the tray can colour the icon green/red without
// running a full sync.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ ok: false, error: "missing-auth" }, { status: 401 });
  }
  const token = auth.slice(7);
  if (!process.env.SYNC_API_KEY || token !== process.env.SYNC_API_KEY) {
    return NextResponse.json({ ok: false, error: "invalid-token" }, { status: 401 });
  }

  const latest = await prisma.party.findFirst({
    orderBy: { lastSyncedAt: "desc" },
    select: { lastSyncedAt: true },
  });

  return NextResponse.json({
    ok: true,
    lastSyncAt: latest?.lastSyncedAt ?? null,
    serverTime: new Date().toISOString(),
  });
}
