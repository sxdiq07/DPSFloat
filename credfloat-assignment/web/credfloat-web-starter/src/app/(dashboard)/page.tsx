import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR, formatINRCompact } from "@/lib/currency";
import { AGE_BUCKET_LABELS, AGE_BUCKETS_ORDER } from "@/lib/ageing";
import { IndianRupee, AlertTriangle, TrendingDown, Send } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const firmId = await requireFirmId();

  // Aggregate queries (all scoped to this firm)
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

  // Build ageing data
  const ageingData = AGE_BUCKETS_ORDER.map((bucket) => {
    const found = ageingBuckets.find((b) => b.ageBucket === bucket);
    return {
      bucket,
      label: AGE_BUCKET_LABELS[bucket],
      amount: Number(found?._sum.outstandingAmount ?? 0),
    };
  });
  const maxAgeing = Math.max(1, ...ageingData.map((d) => d.amount));

  // Hydrate names + debtor counts for just the ranked 10 IDs
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Receivables across all managed client companies
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Total receivables"
          value={formatINRCompact(totalOutstanding)}
          sub={formatINR(totalOutstanding)}
          icon={<IndianRupee className="h-4 w-4" />}
        />
        <Kpi
          label="Overdue 90+ days"
          value={formatINRCompact(overdue90)}
          sub={formatINR(overdue90)}
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          tone="danger"
        />
        <Kpi
          label="Collections this month"
          value={formatINRCompact(collectionsThisMonth)}
          sub={formatINR(collectionsThisMonth)}
          icon={<TrendingDown className="h-4 w-4 text-emerald-600" />}
        />
        <Kpi
          label="Reminders sent today"
          value={`${remindersToday}`}
          sub="Across all channels"
          icon={<Send className="h-4 w-4" />}
        />
      </div>

      {/* Ageing distribution — simple inline bars */}
      <section className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Ageing distribution</h2>
        <div className="space-y-3">
          {ageingData.map((d) => (
            <div key={d.bucket}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{d.label}</span>
                <span className="font-medium">{formatINR(d.amount)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(d.amount / maxAgeing) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Top clients */}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-semibold">Top clients by outstanding</h2>
        </div>
        {topClientsRanked.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Client</th>
                <th className="px-6 py-3 text-right font-medium">Outstanding</th>
                <th className="px-6 py-3 text-right font-medium">Overdue 60+</th>
                <th className="px-6 py-3 text-right font-medium">Debtors</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {topClientsRanked.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="px-6 py-3">
                    <a
                      className="font-medium hover:underline"
                      href={`/clients/${c.id}`}
                    >
                      {c.name}
                    </a>
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {formatINR(c.outstanding)}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums text-red-700">
                    {c.overdue > 0 ? formatINR(c.overdue) : "—"}
                  </td>
                  <td className="px-6 py-3 text-right tabular-nums">
                    {c.debtorCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {icon}
      </div>
      <div
        className={`text-2xl font-semibold tabular-nums ${tone === "danger" ? "text-red-700" : ""}`}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-6 py-16 text-center text-sm text-muted-foreground">
      No client data yet. Run the Tally connector to sync data.
    </div>
  );
}
