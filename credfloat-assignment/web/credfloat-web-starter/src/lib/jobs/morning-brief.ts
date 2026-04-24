import { prisma } from "@/lib/prisma";
import { getISTToday } from "@/lib/ageing";
import { formatINR, formatINRCompact } from "@/lib/currency";
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export type MorningBriefSummary = {
  firmId: string;
  sent: number;
  failed: number;
};

/**
 * Per-firm partner digest: total outstanding, 90+ days overdue,
 * yesterday's reminder dispatch count, and promises due today.
 * Extracted from the cron route so the combined /api/cron/morning
 * endpoint can run it right after the ageing refresh — that way the
 * brief always uses today's freshly-computed buckets.
 */
export async function runMorningBrief(): Promise<{
  rowsAffected: number;
  meta: { summaries: MorningBriefSummary[] };
}> {
  const today = getISTToday();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const firms = await prisma.firm.findMany({
    select: {
      id: true,
      name: true,
      staff: {
        where: { role: "PARTNER" },
        select: { id: true, email: true, name: true },
      },
    },
  });

  const summaries: MorningBriefSummary[] = [];

  for (const firm of firms) {
    const [
      outstandingAgg,
      overdue90Agg,
      newOverdueCount,
      remindersYesterday,
      openPromisesDueToday,
      top,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          clientCompany: { firmId: firm.id },
          status: "OPEN",
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
      }),
      prisma.invoice.aggregate({
        where: {
          clientCompany: { firmId: firm.id },
          status: "OPEN",
          ageBucket: "DAYS_90_PLUS",
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
      }),
      prisma.invoice.count({
        where: {
          clientCompany: { firmId: firm.id },
          status: "OPEN",
          ageBucket: "DAYS_90_PLUS",
          updatedAt: { gte: yesterday },
          deletedAt: null,
        },
      }),
      prisma.reminderSent.count({
        where: {
          sentAt: { gte: yesterday, lt: today },
          party: { clientCompany: { firmId: firm.id } },
        },
      }),
      prisma.promiseToPay.findMany({
        where: {
          status: "OPEN",
          promisedBy: {
            gte: today,
            lt: new Date(today.getTime() + 86400_000),
          },
          party: { clientCompany: { firmId: firm.id } },
        },
        include: {
          party: {
            select: {
              mailingName: true,
              tallyLedgerName: true,
              clientCompany: { select: { displayName: true } },
            },
          },
        },
      }),
      prisma.invoice.groupBy({
        by: ["clientCompanyId"],
        where: {
          clientCompany: { firmId: firm.id },
          status: "OPEN",
          ageBucket: { in: ["DAYS_60_90", "DAYS_90_PLUS"] },
          deletedAt: null,
        },
        _sum: { outstandingAmount: true },
        orderBy: { _sum: { outstandingAmount: "desc" } },
        take: 1,
      }),
    ]);

    const totalOutstanding = Number(outstandingAgg._sum.outstandingAmount ?? 0);
    const overdue90 = Number(overdue90Agg._sum.outstandingAmount ?? 0);

    const topClientName = top[0]
      ? await prisma.clientCompany
          .findUnique({
            where: { id: top[0].clientCompanyId },
            select: { displayName: true },
          })
          .then((c) => c?.displayName ?? null)
      : null;

    const subject = `DPS Ledger · morning brief · ${formatINRCompact(totalOutstanding)} outstanding`;

    const lines = [
      `<p style="margin:0 0 14px">Good morning.</p>`,
      `<p style="margin:0 0 14px"><strong>${firm.name}</strong> is tracking <strong style="color:#0071e3">${formatINR(totalOutstanding)}</strong> across all managed clients today.</p>`,
    ];
    if (overdue90 > 0) {
      lines.push(
        `<p style="margin:0 0 14px">Overdue 90+ days: <strong style="color:#c6373a">${formatINR(overdue90)}</strong>${newOverdueCount > 0 ? ` (${newOverdueCount} new invoice${newOverdueCount === 1 ? "" : "s"} slipped into this bucket)` : ""}.</p>`,
      );
    }
    if (topClientName) {
      lines.push(
        `<p style="margin:0 0 14px">Concentration alert: <strong>${topClientName}</strong> holds the largest overdue-60+ exposure.</p>`,
      );
    }
    lines.push(
      `<p style="margin:0 0 14px">Yesterday, Ledger dispatched <strong>${remindersYesterday}</strong> reminder${remindersYesterday === 1 ? "" : "s"}.</p>`,
    );
    if (openPromisesDueToday.length > 0) {
      lines.push(
        `<p style="margin:0 0 8px"><strong>${openPromisesDueToday.length} promise${openPromisesDueToday.length === 1 ? "" : "s"} to pay</strong> expected today:</p>`,
      );
      lines.push(
        `<ul style="margin:0 0 14px 20px;padding:0">${openPromisesDueToday
          .slice(0, 5)
          .map(
            (p) =>
              `<li>${p.party.mailingName || p.party.tallyLedgerName} (${p.party.clientCompany.displayName}) · ${formatINR(Number(p.amount))}</li>`,
          )
          .join("")}</ul>`,
      );
    }
    lines.push(
      `<p style="margin:0 0 14px"><a href="${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/" style="color:#0071e3">Open Ledger →</a></p>`,
    );

    const html = `<!doctype html><html><body style="font-family:-apple-system,'SF Pro Display','Segoe UI',sans-serif;max-width:560px;margin:20px auto;padding:20px;color:#1d1d1f;line-height:1.5;font-size:15px">${lines.join("")}<hr style="margin-top:24px;border:none;border-top:1px solid #e8e8ed"><p style="font-size:11px;color:#86868b">Sent by DPS Ledger, internal tool for DPS &amp; Co.</p></body></html>`;

    let sent = 0;
    let failed = 0;
    for (const p of firm.staff) {
      if (!p.email) continue;
      if (!resend) {
        console.log("[MORNING BRIEF STUB]", { to: p.email, subject });
        sent++;
        continue;
      }
      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
        to: p.email,
        subject,
        html,
      });
      if (error) failed++;
      else sent++;
    }

    summaries.push({ firmId: firm.id, sent, failed });
  }

  const totalSent = summaries.reduce((a, b) => a + b.sent, 0);
  return { rowsAffected: totalSent, meta: { summaries } };
}
