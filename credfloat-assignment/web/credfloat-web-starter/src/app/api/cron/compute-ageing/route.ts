import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getISTToday } from "@/lib/ageing";
import { Prisma } from "@prisma/client";
import { recordCronRun } from "@/lib/cron";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = getISTToday();

  const { rowsAffected } = await recordCronRun("compute-ageing", async () => {
    // Single-statement ageing refresh. Maps days-overdue → bucket via
    // CASE. Only touches rows whose bucket actually changes so we don't
    // flap updatedAt on invoices that stayed in the same window.
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
  });

  return NextResponse.json({
    updated: rowsAffected,
    timestamp: new Date().toISOString(),
  });
}
