import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR, formatINRCompact } from "@/lib/currency";
import { AGE_BUCKET_LABELS, AGE_BUCKETS_ORDER } from "@/lib/ageing";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const firmId = await requireFirmId();

  const [
    totalOutstandingAgg,
    overdue90Agg,
    collectionsAgg,
    remindersToday,
    ageingBuckets,
    topClientTotals,
    topClientOverdue,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { clientCompany: { firmId }, status: "OPEN" },
      _sum: { outstandingAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { clientCompany: { firmId }, status: "OPEN", ageBucket: "DAYS_90_PLUS" },
      _sum: { outstandingAmount: true },
    }),
    (async () => {
      const start = new Date();
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      return prisma.receipt.aggregate({
        where: { clientCompany: { firmId }, receiptDate: { gte: start } },
        _sum: { amount: true },
      });
    })(),
    (async () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return prisma.reminderSent.count({
        where: {
          sentAt: { gte: startOfToday },
          party: { clientCompany: { firmId } },
        },
      });
    })(),
    prisma.invoice.groupBy({
      by: ["ageBucket"],
      where: { clientCompany: { firmId }, status: "OPEN" },
      _sum: { outstandingAmount: true },
    }),
    prisma.invoice.groupBy({
      by: ["clientCompanyId"],
      where: { clientCompany: { firmId }, status: "OPEN" },
      _sum: { outstandingAmount: true },
      orderBy: { _sum: { outstandingAmount: "desc" } },
      take: 10,
    }),
    prisma.invoice.groupBy({
      by: ["clientCompanyId"],
      where: {
        clientCompany: { firmId },
        status: "OPEN",
        ageBucket: { in: ["DAYS_60_90", "DAYS_90_PLUS"] },
      },
      _sum: { outstandingAmount: true },
    }),
  ]);

  const totalOutstanding = Number(totalOutstandingAgg._sum.outstandingAmount ?? 0);
  const overdue90 = Number(overdue90Agg._sum.outstandingAmount ?? 0);
  const collectionsThisMonth = Number(collectionsAgg._sum.amount ?? 0);

  const ageingData = AGE_BUCKETS_ORDER.map((bucket) => {
    const found = ageingBuckets.find((b) => b.ageBucket === bucket);
    return {
      bucket,
      label: AGE_BUCKET_LABELS[bucket],
      amount: Number(found?._sum.outstandingAmount ?? 0),
    };
  });
  const maxAgeing = Math.max(1, ...ageingData.map((d) => d.amount));

  const topClientIds = topClientTotals.map((t) => t.clientCompanyId);
  const topClientMeta = await prisma.clientCompany.findMany({
    where: { id: { in: topClientIds } },
    select: { id: true, displayName: true, _count: { select: { parties: true } } },
  });
  const metaById = new Map(topClientMeta.map((m) => [m.id, m]));
  const overdueById = new Map(
    topClientOverdue.map((o) => [o.clientCompanyId, Number(o._sum.outstandingAmount ?? 0)]),
  );
  const topClientsRanked = topClientTotals.map((t) => {
    const meta = metaById.get(t.clientCompanyId);
    return {
      id: t.clientCompanyId,
      name: meta?.displayName ?? "(unknown)",
      outstanding: Number(t._sum.outstandingAmount ?? 0),
      overdue: overdueById.get(t.clientCompanyId) ?? 0,
      debtorCount: meta?._count.parties ?? 0,
    };
  });

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section>
        <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-ink-3">
          Firm overview
        </p>
        <h1 className="mt-3 text-display-lg font-semibold text-ink">
          {formatINRCompact(totalOutstanding)}
        </h1>
        <p className="mt-3 text-[17px] text-ink-2">
          in receivables across all managed clients ·{" "}
          <span className="text-ink-3">{formatINR(totalOutstanding)}</span>
        </p>
      </section>

      {/* KPI tiles */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi
          label="Overdue 90+ days"
          value={formatINRCompact(overdue90)}
          sub={formatINR(overdue90)}
          tone="danger"
        />
        <Kpi
          label="Collections this month"
          value={formatINRCompact(collectionsThisMonth)}
          sub={formatINR(collectionsThisMonth)}
          tone="success"
        />
        <Kpi
          label="Reminders sent today"
          value={`${remindersToday}`}
          sub="across email, SMS, WhatsApp"
          tone="neutral"
        />
      </section>

      {/* Ageing distribution */}
      <section className="card-apple p-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-ink">
              Ageing distribution
            </h2>
            <p className="mt-1 text-[14px] text-ink-3">
              Outstanding by days since due date.
            </p>
          </div>
        </div>
        <div className="space-y-5">
          {ageingData.map((d) => (
            <div key={d.bucket}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[14px] font-medium text-ink-2">
                  {d.label}
                </span>
                <span className="tabular text-[14px] font-medium text-ink">
                  {formatINR(d.amount)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-apple"
                  style={{
                    width: `${(d.amount / maxAgeing) * 100}%`,
                    background: ageingGradientFor(d.bucket),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Top clients */}
      <section className="card-apple overflow-hidden">
        <div className="flex items-end justify-between px-8 pt-7 pb-5">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight text-ink">
              Top clients by outstanding
            </h2>
            <p className="mt-1 text-[14px] text-ink-3">
              Ranked in SQL; reflects every OPEN invoice across managed clients.
            </p>
          </div>
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-[hsl(var(--accent-blue))] hover:underline"
          >
            View all
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {topClientsRanked.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden border-t border-subtle">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-8 py-3 text-left font-medium">Client</th>
                  <th className="px-8 py-3 text-right font-medium">
                    Outstanding
                  </th>
                  <th className="px-8 py-3 text-right font-medium">Overdue 60+</th>
                  <th className="px-8 py-3 text-right font-medium">Debtors</th>
                </tr>
              </thead>
              <tbody>
                {topClientsRanked.map((c, i) => (
                  <tr
                    key={c.id}
                    className={`row-interactive ${i > 0 ? "border-t border-subtle" : ""}`}
                  >
                    <td className="px-8 py-4">
                      <Link
                        href={`/clients/${c.id}`}
                        className="font-medium text-ink hover:text-[hsl(var(--accent-blue))]"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="tabular px-8 py-4 text-right font-medium text-ink">
                      {formatINR(c.outstanding)}
                    </td>
                    <td className="tabular px-8 py-4 text-right">
                      {c.overdue > 0 ? (
                        <span
                          style={{ color: "hsl(4 72% 45%)" }}
                          className="font-medium"
                        >
                          {formatINR(c.overdue)}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="tabular px-8 py-4 text-right text-ink-2">
                      {c.debtorCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "danger" | "success" | "neutral";
}) {
  const accent =
    tone === "danger"
      ? "hsl(4 72% 45%)"
      : tone === "success"
        ? "hsl(142 64% 36%)"
        : "hsl(var(--ink))";
  const dotGradient =
    tone === "danger"
      ? "linear-gradient(135deg, hsl(4 100% 62%), hsl(14 95% 58%))"
      : tone === "success"
        ? "linear-gradient(135deg, hsl(142 70% 45%), hsl(168 75% 42%))"
        : "linear-gradient(135deg, hsl(211 100% 44%), hsl(260 75% 55%))";

  return (
    <div className="card-apple p-7">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
          {label}
        </span>
        <span
          aria-hidden
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: dotGradient }}
        />
      </div>
      <div
        className="tabular text-[32px] font-semibold leading-none tracking-tight"
        style={{ color: accent }}
      >
        {value}
      </div>
      <div className="mt-2 text-[13px] text-ink-3">{sub}</div>
    </div>
  );
}

function ageingGradientFor(bucket: string): string {
  switch (bucket) {
    case "CURRENT":
      return "linear-gradient(90deg, hsl(142 70% 45%), hsl(168 75% 42%))";
    case "DAYS_0_30":
      return "linear-gradient(90deg, hsl(211 100% 50%), hsl(200 100% 48%))";
    case "DAYS_30_60":
      return "linear-gradient(90deg, hsl(44 100% 50%), hsl(32 100% 52%))";
    case "DAYS_60_90":
      return "linear-gradient(90deg, hsl(22 100% 52%), hsl(14 95% 55%))";
    case "DAYS_90_PLUS":
      return "linear-gradient(90deg, hsl(4 100% 62%), hsl(350 85% 55%))";
    default:
      return "hsl(var(--ink-3))";
  }
}

function EmptyState() {
  return (
    <div className="px-8 py-16 text-center">
      <p className="text-[15px] text-ink-2">No client data yet.</p>
      <p className="mt-1 text-[13px] text-ink-3">
        Run the Tally connector to sync data.
      </p>
    </div>
  );
}
