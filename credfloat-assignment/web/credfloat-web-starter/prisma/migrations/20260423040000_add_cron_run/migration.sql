-- CronRun: one row per background-job invocation. Populated by
-- recordCronRun() wrapper in src/lib/cron.ts; surfaced via the Jobs
-- tile on the Overview.

CREATE TYPE "CronStatus" AS ENUM ('RUNNING', 'OK', 'FAILED');

CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "CronStatus" NOT NULL DEFAULT 'RUNNING',
    "rowsAffected" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "error" TEXT,
    "meta" JSONB,
    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CronRun_job_startedAt_idx" ON "CronRun"("job", "startedAt");
CREATE INDEX "CronRun_status_idx" ON "CronRun"("status");

-- RLS lockdown (same rationale as 20260423030000)
ALTER TABLE "CronRun" ENABLE ROW LEVEL SECURITY;
