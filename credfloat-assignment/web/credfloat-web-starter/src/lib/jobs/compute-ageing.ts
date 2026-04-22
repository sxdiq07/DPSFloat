import { prisma } from "@/lib/prisma";
import { getISTToday } from "@/lib/ageing";
import { Prisma } from "@prisma/client";

/**
 * Recomputes the ageBucket on every OPEN invoice based on days-
 * overdue relative to IST today. Extracted from the cron route so
 * the combined /api/cron/morning endpoint can call it alongside
 * the morning brief.
 *
 * Returns { rowsAffected } in the shape recordCronRun expects.
 */
export async function runComputeAgeing(): Promise<{ rowsAffected: number }> {
  const today = getISTToday();
  const result = await prisma.$executeRaw(Prisma.sql`
    UPDATE "Invoice" AS i
    SET "ageBucket" = b.bucket::"AgeBucket",
        "updatedAt" = NOW()
    FROM (
      SELECT
        "id",
        CASE
          WHEN DATE_PART('day', ${today}::timestamp - "dueDate") <= 0 THEN 'CURRENT'
          WHEN DATE_PART('day', ${today}::timestamp - "dueDate") <= 30 THEN 'DAYS_0_30'
          WHEN DATE_PART('day', ${today}::timestamp - "dueDate") <= 60 THEN 'DAYS_30_60'
          WHEN DATE_PART('day', ${today}::timestamp - "dueDate") <= 90 THEN 'DAYS_60_90'
          ELSE 'DAYS_90_PLUS'
        END AS bucket
      FROM "Invoice"
      WHERE "status" = 'OPEN' AND "dueDate" IS NOT NULL
    ) AS b
    WHERE i."id" = b."id"
      AND i."ageBucket"::text <> b.bucket
  `);
  return { rowsAffected: Number(result) };
}
