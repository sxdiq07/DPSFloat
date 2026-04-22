import { NextRequest, NextResponse } from "next/server";
import { recordCronRun } from "@/lib/cron";
import { runComputeAgeing } from "@/lib/jobs/compute-ageing";
import { runMorningBrief } from "@/lib/jobs/morning-brief";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Combined morning-batch endpoint. Vercel Hobby caps at 2 cron jobs,
 * so ageing + brief share one cron slot here. Each sub-job still
 * writes its own CronRun row (via its own recordCronRun wrapper) so
 * the Jobs health tile on the Overview shows them independently.
 *
 * Ordering matters: ageing runs first so the brief reports today's
 * fresh buckets, not yesterday's. If ageing fails we still attempt
 * the brief so partners at least get stale-but-meaningful numbers.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let ageingUpdated = 0;
  let ageingError: string | null = null;
  try {
    const a = await recordCronRun("compute-ageing", runComputeAgeing);
    ageingUpdated = a.rowsAffected ?? 0;
  } catch (err) {
    ageingError = err instanceof Error ? err.message : String(err);
  }

  let briefSummaries: Array<{
    firmId: string;
    sent: number;
    failed: number;
  }> = [];
  let briefError: string | null = null;
  try {
    const b = await recordCronRun("morning-brief", runMorningBrief);
    briefSummaries = (b.meta?.summaries ?? []) as typeof briefSummaries;
  } catch (err) {
    briefError = err instanceof Error ? err.message : String(err);
  }

  const status =
    ageingError || briefError ? (briefError ? 500 : 200) : 200;
  return NextResponse.json(
    {
      ageing: {
        updated: ageingUpdated,
        error: ageingError,
      },
      brief: {
        summaries: briefSummaries,
        error: briefError,
      },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
