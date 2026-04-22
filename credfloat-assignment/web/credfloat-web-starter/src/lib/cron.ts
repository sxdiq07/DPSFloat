import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type CronJob =
  | "compute-ageing"
  | "morning-brief"
  | "send-reminders";

type CronFnResult = {
  rowsAffected?: number;
  meta?: Prisma.InputJsonValue;
};

/**
 * Wraps a cron handler so its start, finish, and outcome land in
 * CronRun. Never swallows the inner error — the handler still throws
 * so Next.js surfaces the 500, but we ensure a FAILED row is written
 * first. Failures inside recordCronRun itself only log; we never want
 * the audit layer to mask the actual cron outcome.
 */
export async function recordCronRun<T extends CronFnResult>(
  job: CronJob,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  let runId: string | null = null;
  try {
    const row = await prisma.cronRun.create({
      data: { job, startedAt, status: "RUNNING" },
      select: { id: true },
    });
    runId = row.id;
  } catch (err) {
    console.error(`[cron:${job}] failed to open CronRun row:`, err);
  }

  try {
    const out = await fn();
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    if (runId) {
      await prisma.cronRun
        .update({
          where: { id: runId },
          data: {
            status: "OK",
            completedAt,
            durationMs,
            rowsAffected: out.rowsAffected ?? 0,
            meta: out.meta,
          },
        })
        .catch((e) => console.error(`[cron:${job}] close-row failed:`, e));
    }
    return out;
  } catch (err) {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const message = err instanceof Error ? err.message : String(err);

    if (runId) {
      await prisma.cronRun
        .update({
          where: { id: runId },
          data: {
            status: "FAILED",
            completedAt,
            durationMs,
            error: message.slice(0, 2000),
          },
        })
        .catch((e) =>
          console.error(`[cron:${job}] close-row (FAILED) failed:`, e),
        );
    }
    throw err;
  }
}
