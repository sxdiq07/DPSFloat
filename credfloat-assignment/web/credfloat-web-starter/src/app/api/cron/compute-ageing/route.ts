import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/cron";
import { runComputeAgeing } from "@/lib/jobs/compute-ageing";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Kept as a standalone endpoint so `curl` can test the job and so
 * paid tiers can still schedule it independently. The Hobby-tier
 * deployment points Vercel cron at /api/cron/morning instead, which
 * runs this plus the morning brief in sequence.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rowsAffected } = await recordCronRun(
    "compute-ageing",
    runComputeAgeing,
  );

  return NextResponse.json({
    updated: rowsAffected,
    timestamp: new Date().toISOString(),
  });
}
