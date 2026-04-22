import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/cron";
import { runMorningBrief } from "@/lib/jobs/morning-brief";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Kept as a standalone endpoint for manual testing. On Hobby tier
 * Vercel cron fires /api/cron/morning instead, which runs the
 * ageing refresh first then this.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outcome = await recordCronRun("morning-brief", runMorningBrief);

  const meta = (outcome.meta ?? {}) as {
    summaries?: Array<{ firmId: string; sent: number; failed: number }>;
  };
  return NextResponse.json({
    summaries: meta.summaries ?? [],
    timestamp: new Date().toISOString(),
  });
}
