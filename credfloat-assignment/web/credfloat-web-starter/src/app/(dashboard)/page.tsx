import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { formatINR, formatINRCompact } from "@/lib/currency";
import { AGE_BUCKET_LABELS, AGE_BUCKETS_ORDER } from "@/lib/ageing";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { StatCard } from "@/components/ui/stat-card";
import { StackedBar } from "@/components/ui/stacked-bar";

export const dynamic = "force-dynamic";

const AGEING_THEME: Record<string, { gradient: string; solid: string }> = {
  CURRENT: {
    gradient: "linear-gradient(90deg, #30d158, #34c7b8)",
    solid: "#30d158",
  },
  DAYS_0_30: {
    gradient: "linear-gradient(90deg, #0a84ff, #5e5ce6)",
    solid: "#0a84ff",
  },
  DAYS_30_60: {
    gradient: "linear-gradient(90deg, #ffd60a, #ff9f0a)",
    solid: "#ff9f0a",
  },
  DAYS_60_90: {
    gradient: "linear-gradient(90deg, #ff9f0a, #ff6b3d)",
    solid: "#ff6b3d",
  },
  DAYS_90_PLUS: {
    gradient: "linear-gradient(90deg, #ff453a, #ff375f)",
    solid: "#ff453a",
  },
};

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
    partyCount,
    clientCount,
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
    prisma.party.count({ where: { clientCompany: { firmId } } }),
    prisma.clientCompany.count({ where: { firmId } }),
  ]);

  const totalOutstanding = Number(totalOutstandingAgg._sum.outstandingAmount ?? 0);
  const overdue90 = Number(overdue90Agg._sum.outstandingAmount ?? 0);
  const collectionsThisMonth = Number(collectionsAgg._sum.amount ?? 0);

  const ageingData = AGE_BUCKETS_ORDER.map((bucket) => ({
    key: bucket,
    label: AGE_BUCKET_LABELS[bucket],
    value: Number(
      ageingBuckets.find((b) => b.ageBucket === bucket)?._sum.outstandingAmount ?? 0,
    ),
    gradient: AGEING_THEME[bucket].gradient,
    solid: AGEING_THEME[bucket].solid,
  }));

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

  const maxOutstanding = Math.max(1, ...topClientsRanked.map((c) => c.outstanding));

  return (
    <div className="space-y-14">
      <PageHeader
        eyebrow="Firm overview"
        title="Receivables"
        subtitle={
          <>
            Tracking {formatINRCompact(totalOutstanding)} across {clientCount}{" "}
            client {clientCount === 1 ? "company" : "companies"} and{" "}
            {partyCount.toLocaleString("en-IN")} debtor{" "}
            {partyCount === 1 ? "ledger" : "ledgers"}.
          </>
        }
      />

      {/* Hero number — huge, animated */}
      <section className="card-apple relative overflow-hidden p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-20 -top-20 h-80 w-80 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(0,113,227,0.28), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-20 h-80 w-80 rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(191,90,242,0.22), transparent 70%)",
          }}
        />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Total outstanding receivables
          </p>
          <div
            className="tabular mt-4 font-semibold leading-none tracking-tightest text-ink"
            style={{ fontSize: "clamp(56px, 8vw, 88px)" }}
          >
            <span style={{ opacity: 0.5, fontWeight: 300, marginRight: "0.08em" }}>
              ₹
            </span>
            <AnimatedNumber
              value={totalOutstanding}
              duration={1100}
                />
          </div>
          <p className="mt-5 text-[14px] text-ink-3">
            Updated live from every {clientCount > 0 ? "managed" : "synced"} client.
          </p>
        </div>
      </section>

      {/* KPI strip */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <StatCard
          label="Overdue 90+ days"
          value={overdue90}
          tone="danger"
          prefix="₹"
          sub="Oldest receivables carrying the most risk"
        />
        <StatCard
          label="Collections this month"
          value={collectionsThisMonth}
          tone="success"
          prefix="₹"
          sub="Receipts matched against open invoices"
        />
        <StatCard
          label="Reminders sent today"
          value={remindersToday}
          tone="accent"
          animate={false}
          sub="Email, SMS and WhatsApp combined"
        />
      </section>

      {/* Ageing distribution */}
      <section className="card-apple p-10">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Ageing analysis
            </p>
            <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">
              Outstanding by days overdue
            </h2>
            <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-ink-3">
              Single glance at how much of the book sits in each bucket. Hover
              any segment to isolate it.
            </p>
          </div>
        </div>
        <StackedBar segments={ageingData} />
      </section>

      {/* Top clients */}
      <section className="card-apple overflow-hidden">
        <div className="flex items-end justify-between gap-6 px-10 pt-9 pb-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Top clients
            </p>
            <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">
              Where the book is concentrated
            </h2>
            <p className="mt-1.5 text-[14px] text-ink-3">
              Ranked in SQL by total outstanding · refreshes on every load.
            </p>
          </div>
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--color-accent-blue)] transition-colors hover:text-[var(--color-accent-blue-hover)]"
          >
            All clients
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {topClientsRanked.length === 0 ? (
          <div className="border-t border-subtle px-10 py-16 text-center">
            <p className="text-[15px] text-ink-2">No client data yet.</p>
            <p className="mt-1 text-[13px] text-ink-3">
              Run the Tally connector to sync data.
            </p>
          </div>
        ) : (
          <div className="border-t border-subtle">
            {topClientsRanked.map((c, i) => {
              const initials = c.name
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase();
              const widthPct = (c.outstanding / maxOutstanding) * 100;
              return (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className={`group relative flex items-center gap-5 px-10 py-5 transition-colors hover:bg-[var(--color-surface-2)]/60 ${i > 0 ? "border-t border-subtle" : ""}`}
                >
                  {/* Accent bar */}
                  <div
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-[3px] origin-top scale-y-0 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-y-100"
                    style={{ background: "var(--color-accent-blue)" }}
                  />

                  {/* Initials avatar */}
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-white"
                    style={{
                      background: `linear-gradient(135deg, hsl(${(i * 47) % 360} 70% 55%), hsl(${(i * 47 + 30) % 360} 80% 45%))`,
                    }}
                    aria-hidden
                  >
                    {initials}
                  </div>

                  {/* Name + debtor count + bar */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="truncate text-[15px] font-medium text-ink group-hover:text-[var(--color-accent-blue)]">
                        {c.name}
                      </div>
                      <div className="tabular shrink-0 text-[15px] font-semibold text-ink">
                        {formatINR(c.outstanding)}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-4">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                          style={{
                            width: `${widthPct}%`,
                            background:
                              c.overdue > 0
                                ? "linear-gradient(90deg, #ff9f0a, #ff453a)"
                                : "linear-gradient(90deg, #0a84ff, #5e5ce6)",
                          }}
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[12px] text-ink-3">
                        <span className="tabular">
                          {c.debtorCount} debtor
                          {c.debtorCount === 1 ? "" : "s"}
                        </span>
                        {c.overdue > 0 && (
                          <span
                            className="pill tabular"
                            style={{
                              background: "rgba(255,69,58,0.08)",
                              color: "#c6373a",
                            }}
                          >
                            {formatINRCompact(c.overdue)} overdue
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
