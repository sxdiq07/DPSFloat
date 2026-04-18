import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeAgeBucket } from "@/lib/ageing";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  // Load all OPEN invoices and recompute their age bucket.
  // For 300 clients this is typically a few thousand rows — fine for V1.
  // At scale, batch this with SQL CASE expressions.
  const invoices = await prisma.invoice.findMany({
    where: { status: "OPEN", dueDate: { not: null } },
    select: { id: true, dueDate: true, ageBucket: true },
  });

  let updated = 0;
  for (const inv of invoices) {
    if (!inv.dueDate) continue;
    const bucket = computeAgeBucket(inv.dueDate, today);
    if (bucket !== inv.ageBucket) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { ageBucket: bucket },
      });
      updated++;
    }
  }

  return NextResponse.json({
    scanned: invoices.length,
    updated,
    timestamp: new Date().toISOString(),
  });
}
