import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR } from "@/lib/currency";
import { AGE_BUCKET_LABELS, AGE_BUCKETS_ORDER } from "@/lib/ageing";
import { PageHeader } from "@/components/ui/page-header";
import { CollectionsTrend, TrendPoint } from "./_components/collections-trend";
import { AgeingDonut, DonutSlice } from "./_components/ageing-donut";

export const dynamic = "force-dynamic";

const BUCKET_COLORS: Record<string, string> = {
  CURRENT: "#30d158",
  DAYS_0_30: "#0a84ff",
  DAYS_30_60: "#ff9f0a",
  DAYS_60_90: "#ff6b3d",
  DAYS_90_PLUS: "#ff453a",
};

export default async function ReportsPage() {
  const firmId = await requireFirmId();

  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const [ageingBuckets, receipts, clientReach] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["ageBucket"],
      where: { clientCompany: { firmId }, status: "OPEN" },
      _sum: { outstandingAmount: true },
    }),
    prisma.receipt.findMany({
      where: {
        clientCompany: { firmId },
        receiptDate: { gte: twelveMonthsAgo },
      },
      select: { amount: true, receiptDate: true },
    }),
    prisma.clientCompany.findMany({
      where: { firmId },
      select: {
        id: true,
        displayName: true,
        _count: { select: { parties: true } },
        parties: {
          where: {
            OR: [
              { email: { not: null } },
              { phone: { not: null } },
              { whatsappNumber: { not: null } },
            ],
          },
          select: { id: true },
        },
      },
    }),
  ]);

  // Build 12-month trend, zero-filled
  const monthBuckets = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo);
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthBuckets.set(key, 0);
  }
  for (const r of receipts) {
    const d = new Date(r.receiptDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthBuckets.has(key)) {
      monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + Number(r.amount));
    }
  }
  const trendData: TrendPoint[] = [...monthBuckets.entries()].map(([key, total]) => {
    const [y, m] = key.split("-");
    const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(
      "en-IN",
      { month: "short" },
    );
    return { month: key, label: monthName, total };
  });

  // Ageing donut slices
  const slices: DonutSlice[] = AGE_BUCKETS_ORDER.map((bucket) => ({
    key: bucket,
    label: AGE_BUCKET_LABELS[bucket],
    value: Number(
      ageingBuckets.find((b) => b.ageBucket === bucket)?._sum.outstandingAmount ?? 0,
    ),
    color: BUCKET_COLORS[bucket],
  }));
  const ageingTotal = slices.reduce((s, x) => s + x.value, 0);

  // Reachability leaderboard
  const reachabilityRows = clientReach
    .map((c) => {
      const total = c._count.parties;
      const reachable = c.parties.length;
      const pct = total === 0 ? 0 : (reachable / total) * 100;
      return {
        id: c.id,
        name: c.displayName,
        total,
        reachable,
        pct,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        subtitle="Collection velocity, ageing distribution, and contact data quality across every client."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Collections trend — 3 cols */}
        <section className="card-apple p-8 lg:col-span-3">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                Collections
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
                12-month receipts trend
              </h2>
              <p className="mt-1 text-[13px] text-ink-3">
                Sum of receipts per calendar month (IST).
              </p>
            </div>
          </div>
          <CollectionsTrend data={trendData} />
        </section>

        {/* Ageing donut — 2 cols */}
        <section className="card-apple p-8 lg:col-span-2">
          <div className="mb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Ageing
            </p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
              Outstanding by bucket
            </h2>
            <p className="mt-1 text-[13px] text-ink-3">
              Share of open book in each age window.
            </p>
          </div>
          <AgeingDonut slices={slices} total={ageingTotal} />
          <div className="mt-6 space-y-2">
            {slices.map((s) => {
              const pct =
                ageingTotal === 0 ? 0 : (s.value / ageingTotal) * 100;
              return (
                <div
                  key={s.key}
                  className="flex items-center justify-between text-[13px]"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ background: s.color }}
                    />
                    <span className="text-ink-2">{s.label}</span>
                  </div>
                  <div className="tabular text-ink-3">
                    <span className="font-medium text-ink">
                      {formatINR(s.value)}
                    </span>
                    <span className="ml-2 text-[11px]">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Reachability leaderboard */}
      <section className="card-apple overflow-hidden">
        <div className="px-8 pt-8 pb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Data quality
          </p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            Contact reachability by client
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-ink-3">
            Percentage of each client&apos;s debtor ledgers that have at least
            one digital contact (email, WhatsApp, or phone) on file. The
            unreachable ones need physical mail — or back-office enrichment in
            Tally.
          </p>
        </div>

        {reachabilityRows.length === 0 ? (
          <div className="border-t border-subtle px-8 py-16 text-center">
            <p className="text-[15px] text-ink-2">No client data yet.</p>
            <p className="mt-1 text-[13px] text-ink-3">
              Once the connector syncs, this ranks every client by their
              debtor-count.
            </p>
          </div>
        ) : (
          <div className="border-t border-subtle">
            {reachabilityRows.map((r, i) => {
              const tone =
                r.pct >= 50
                  ? { solid: "#30d158", label: "#1f7a4a" }
                  : r.pct >= 20
                    ? { solid: "#0a84ff", label: "#0057b7" }
                    : { solid: "#ff453a", label: "#c6373a" };
              return (
                <div
                  key={r.id}
                  className={`grid grid-cols-[1fr_auto] gap-5 px-8 py-4 ${i > 0 ? "border-t border-subtle" : ""}`}
                >
                  <div className="space-y-2">
                    <div className="text-[14px] font-medium text-ink">
                      {r.name}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                      <div
                        className="h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                        style={{ width: `${r.pct}%`, background: tone.solid }}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="tabular text-[14px] font-semibold"
                      style={{ color: tone.label }}
                    >
                      {r.pct.toFixed(1)}%
                    </div>
                    <div className="tabular text-[11px] text-ink-3">
                      {r.reachable} of {r.total}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
