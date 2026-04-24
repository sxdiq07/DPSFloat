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
import { PipelineStory } from "./_components/pipeline-story";
import { DuplicateExposure } from "./_components/duplicate-exposure";
import {
  ForecastDrillDown,
  type ForecastDrillRow,
} from "./_components/forecast-drilldown";
import { groupDuplicates, type DupCandidate } from "@/lib/duplicates";
import { formatDistanceToNow } from "date-fns";
import {
  computeForecastML,
  backtestForecast,
} from "@/lib/forecast";

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
    // Total outstanding = sum of positive debtor ledger balances. The
    // ledger is the truth — it nets every invoice, receipt, credit note
    // and journal adjustment Tally knows about. Invoice-level sums can
    // diverge when receipts landed on non-debtor ledgers we didn't sync.
    prisma.party.aggregate({
      where: {
        clientCompany: { firmId },
        closingBalance: { gt: 0 },
        deletedAt: null,
      },
      _sum: { closingBalance: true },
    }),
    // 90+ bucket stays invoice-based — ageing only exists at bill level.
    prisma.invoice.aggregate({
      where: {
        clientCompany: { firmId },
        status: "OPEN",
        ageBucket: "DAYS_90_PLUS",
        deletedAt: null,
      },
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
      where: { clientCompany: { firmId }, status: "OPEN", deletedAt: null },
      _sum: { outstandingAmount: true },
    }),
    // Top clients by actual due — sum of debtors' positive ledger
    // balances per client. Group at the party level, then aggregate by
    // clientCompanyId. Matches the "ledger balance is the truth" rule
    // used for the firm-level total.
    prisma.party.groupBy({
      by: ["clientCompanyId"],
      where: {
        clientCompany: { firmId },
        closingBalance: { gt: 0 },
        deletedAt: null,
      },
      _sum: { closingBalance: true },
      orderBy: { _sum: { closingBalance: "desc" } },
      take: 10,
    }),
    prisma.invoice.groupBy({
      by: ["clientCompanyId"],
      where: {
        clientCompany: { firmId },
        status: "OPEN",
        ageBucket: { in: ["DAYS_60_90", "DAYS_90_PLUS"] },
        deletedAt: null,
      },
      _sum: { outstandingAmount: true },
    }),
    prisma.party.count({
      where: { clientCompany: { firmId }, deletedAt: null },
    }),
    prisma.clientCompany.count({ where: { firmId } }),
  ]);

  // Cross-client duplicate detection — ledger balance (closingBalance)
  // is the real exposure number. Parties with non-positive balances
  // aren't a risk.
  const dupSource = await prisma.party.findMany({
    where: {
      clientCompany: { firmId },
      closingBalance: { gt: 0 },
      deletedAt: null,
    },
    select: {
      id: true,
      tallyLedgerName: true,
      mailingName: true,
      closingBalance: true,
      clientCompanyId: true,
      clientCompany: { select: { displayName: true } },
    },
  });
  const dupGroups = groupDuplicates(
    dupSource.map<DupCandidate>((p) => ({
      id: p.id,
      tallyLedgerName: p.tallyLedgerName,
      mailingName: p.mailingName,
      closingBalance: Number(p.closingBalance),
      clientCompanyId: p.clientCompanyId,
      clientCompanyName: p.clientCompany.displayName,
    })),
  ).slice(0, 10);

  // Secondary queries for the storytelling section
  const [reachableCount, lastSync, brokenPromiseCounts, cronRuns] =
    await Promise.all([
    prisma.party.count({
      where: {
        clientCompany: { firmId },
        deletedAt: null,
        OR: [
          { email: { not: null } },
          { phone: { not: null } },
          { whatsappNumber: { not: null } },
        ],
      },
    }),
    prisma.party.findFirst({
      where: { clientCompany: { firmId }, deletedAt: null },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    // Count broken promises per party — feeds the "at risk" surface.
    prisma.promiseToPay.groupBy({
      by: ["partyId"],
      where: {
        party: { clientCompany: { firmId } },
        status: "BROKEN",
      },
      _count: { _all: true },
    }),
    // Latest run per cron job (limit 20, then dedupe below to keep
    // the query cheap — avoids a DISTINCT ON).
    prisma.cronRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        job: true,
        startedAt: true,
        completedAt: true,
        status: true,
        rowsAffected: true,
        durationMs: true,
        error: true,
      },
    }),
  ]);

  // At-risk debtors: broke ≥ 2 promises AND have 90+ overdue bills.
  const brokenByParty = new Map(
    brokenPromiseCounts.map((g) => [g.partyId, g._count._all]),
  );
  const atRiskPartyIds = [...brokenByParty.entries()]
    .filter(([, n]) => n >= 2)
    .map(([partyId]) => partyId);
  const atRiskParties =
    atRiskPartyIds.length === 0
      ? []
      : await prisma.party.findMany({
          where: {
            id: { in: atRiskPartyIds },
            deletedAt: null,
            invoices: {
              some: {
                status: "OPEN",
                ageBucket: "DAYS_90_PLUS",
                deletedAt: null,
              },
            },
          },
          select: {
            id: true,
            tallyLedgerName: true,
            mailingName: true,
            closingBalance: true,
            clientCompanyId: true,
            clientCompany: { select: { displayName: true } },
          },
          orderBy: { closingBalance: "desc" },
          take: 5,
        });
  const atRiskRows = atRiskParties.map((p) => ({
    id: p.id,
    name: p.mailingName || p.tallyLedgerName,
    clientCompanyId: p.clientCompanyId,
    clientCompanyName: p.clientCompany.displayName,
    closingBalance: Number(p.closingBalance),
    brokenPromises: brokenByParty.get(p.id) ?? 0,
  }));

  const totalOutstanding = Number(totalOutstandingAgg._sum.closingBalance ?? 0);
  const overdue90 = Number(overdue90Agg._sum.outstandingAmount ?? 0);
  const collectionsThisMonth = Number(collectionsAgg._sum.amount ?? 0);

  // Cash-inflow forecast. Random-forest classifier trained on the
  // firm's own bill→receipt timing history; falls back to calibrated
  // base rates when there isn't enough history to train.
  const [openInvoicesForForecast, openPromises, disputedIds] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        clientCompany: { firmId },
        status: "OPEN",
        outstandingAmount: { gt: 0 },
        deletedAt: null,
      },
      select: {
        id: true,
        partyId: true,
        billDate: true,
        dueDate: true,
        originalAmount: true,
        outstandingAmount: true,
        ageBucket: true,
        origin: true,
      },
    }),
    prisma.promiseToPay.findMany({
      where: {
        status: "OPEN",
        party: { clientCompany: { firmId } },
        promisedBy: {
          gte: new Date(),
          lt: new Date(Date.now() + 90 * 86400_000),
        },
      },
      include: {
        party: {
          select: {
            id: true,
            promises: { where: { status: { in: ["KEPT", "BROKEN"] } }, select: { status: true } },
          },
        },
      },
      orderBy: { promisedBy: "asc" },
    }),
    prisma.invoice.findMany({
      where: {
        clientCompany: { firmId },
        status: "DISPUTED",
        deletedAt: null,
      },
      select: { id: true, partyId: true },
    }),
  ]);
  const disputedPartyIds = new Set(disputedIds.map((d) => d.partyId));

  const promisesByParty = new Map<
    string,
    { amount: number; promisedBy: Date; keepRate: number }
  >();
  for (const p of openPromises) {
    const concluded = p.party.promises;
    const kept = concluded.filter((x) => x.status === "KEPT").length;
    const total = concluded.length;
    const keepRate = total === 0 ? 0.6 : kept / total;
    const existing = promisesByParty.get(p.partyId);
    if (!existing || p.promisedBy < existing.promisedBy) {
      promisesByParty.set(p.partyId, {
        amount: Number(p.amount),
        promisedBy: p.promisedBy,
        keepRate,
      });
    }
  }

  const { forecast, meta: forecastMeta } = await computeForecastML(
    firmId,
    openInvoicesForForecast.map((i) => ({
      id: i.id,
      partyId: i.partyId,
      billDate: i.billDate,
      dueDate: i.dueDate,
      originalAmount: Number(i.originalAmount),
      outstandingAmount: Number(i.outstandingAmount),
      ageBucket: i.ageBucket,
      isDisputed: disputedPartyIds.has(i.partyId),
      origin: i.origin,
    })),
    promisesByParty,
  );

  // Backtest — last 3 complete months, predicted vs actual.
  // Guarded: if the DB is too empty we fall back to zero — the UI
  // handles the missing-data case.
  const backtest = await backtestForecast(firmId, 3).catch(() => null);

  // Debtor-wise drill-down — EVERY debtor contributing to the 30-day
  // forecast, plus their ML-predicted days-to-pay. The UI handles
  // ranking, filtering, and top-10-vs-full toggle.
  const drillPartyIds = [...forecast.byParty.keys()].filter((pid) => {
    const amts = forecast.byParty.get(pid);
    if (!amts) return false;
    return amts[7] > 0 || amts[14] > 0 || amts[30] > 0 || amts[60] > 0;
  });
  const drillParties =
    drillPartyIds.length === 0
      ? []
      : await prisma.party.findMany({
          where: { id: { in: drillPartyIds } },
          select: {
            id: true,
            tallyLedgerName: true,
            mailingName: true,
            clientCompanyId: true,
            clientCompany: { select: { displayName: true } },
          },
        });
  const drillPartyMeta = new Map(drillParties.map((p) => [p.id, p]));
  const drillRows: ForecastDrillRow[] = drillPartyIds
    .map((pid) => {
      const meta = drillPartyMeta.get(pid);
      if (!meta) return null;
      const amts = forecast.byParty.get(pid) ?? { 7: 0, 14: 0, 30: 0, 60: 0, 90: 0 };
      const dtp = forecast.daysToPayByParty.get(pid);
      return {
        partyId: pid,
        name: meta.mailingName || meta.tallyLedgerName,
        clientCompanyId: meta.clientCompanyId,
        clientCompanyName: meta.clientCompany.displayName,
        amounts: { 7: amts[7], 14: amts[14], 30: amts[30], 60: amts[60] },
        daysToPay: dtp
          ? {
              days: dtp.days,
              lowDays: dtp.lowDays,
              highDays: dtp.highDays,
              sampleSize: dtp.sampleSize,
              confidence: dtp.confidence,
              recommendedTermDays: dtp.recommendedTermDays,
              termCaveat: dtp.termCaveat,
            }
          : null,
        outstandingAmount: dtp?.outstandingAmount ?? 0,
      };
    })
    .filter((r): r is ForecastDrillRow => r !== null)
    .sort((a, b) => b.amounts[30] - a.amounts[30]);

  // Latest run per job — cronRuns is pre-sorted desc by startedAt so
  // first occurrence of each job name wins.
  const jobOrder: Array<{ id: string; label: string }> = [
    { id: "send-reminders", label: "Reminder dispatch" },
    { id: "morning-brief", label: "Morning brief" },
    { id: "compute-ageing", label: "Ageing refresh" },
  ];
  const latestByJob = new Map<string, (typeof cronRuns)[number]>();
  for (const r of cronRuns) if (!latestByJob.has(r.job)) latestByJob.set(r.job, r);
  const jobRows = jobOrder.map((j) => ({
    ...j,
    run: latestByJob.get(j.id) ?? null,
  }));

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
      outstanding: Number(t._sum.closingBalance ?? 0),
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
          <p className="mt-5 text-[15px] text-ink-3">
            Updated live from every {clientCount > 0 ? "managed" : "synced"} client.
          </p>
        </div>
      </section>

      {/* Storytelling: pipeline + narrative */}
      <PipelineStory
        totalOutstandingCompact={formatINRCompact(totalOutstanding)}
        partyCount={partyCount}
        reachableCount={reachableCount}
        clientCount={clientCount}
        remindersToday={remindersToday}
        lastSyncRelative={
          lastSync?.lastSyncedAt
            ? formatDistanceToNow(lastSync.lastSyncedAt, { addSuffix: true })
            : "never"
        }
      />

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

      {/* Cash inflow forecast */}
      <section className="card-apple overflow-hidden">
        <div className="flex flex-col gap-6 px-10 pt-9 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                Cash inflow forecast
              </p>
              {backtest && backtest.samples >= 2 && backtest.actualThisPeriod > 0 && (
                <span
                  className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
                  style={{
                    borderColor:
                      backtest.accuracyPct >= 85
                        ? "rgba(48,209,88,0.30)"
                        : backtest.accuracyPct >= 70
                          ? "rgba(0,113,227,0.30)"
                          : "rgba(245,158,11,0.30)",
                    background:
                      backtest.accuracyPct >= 85
                        ? "rgba(48,209,88,0.10)"
                        : backtest.accuracyPct >= 70
                          ? "rgba(0,113,227,0.08)"
                          : "rgba(245,158,11,0.10)",
                    color:
                      backtest.accuracyPct >= 85
                        ? "#1f7a4a"
                        : backtest.accuracyPct >= 70
                          ? "#0057b7"
                          : "#92400e",
                  }}
                  title={`Backtested on ${backtest.samples} complete month${backtest.samples === 1 ? "" : "s"}: predicted ${formatINRCompact(backtest.predictedThisPeriod)} vs actual ${formatINRCompact(backtest.actualThisPeriod)}.`}
                >
                  {backtest.accuracyPct.toFixed(0)}% accurate
                </span>
              )}
            </div>
            <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-ink">
              Predicted receipts over the next 7 to 90 days
            </h2>
            <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-ink-3">
              {forecastMeta.method === "random_forest" ? (
                <>
                  Random-forest classifier trained nightly on this
                  firm&apos;s own bill-to-receipt history ({forecastMeta.samples.toLocaleString("en-IN")} historical pairs).
                  Each open bill gets a per-horizon probability based on
                  ageing, amount, debtor payment velocity, dispute state,
                  and open promise-to-pay. Accuracy badge is measured on
                  the last {backtest?.samples ?? 3} complete month
                  {(backtest?.samples ?? 3) === 1 ? "" : "s"}.
                </>
              ) : (
                <>
                  Calibrated on this firm&apos;s receipt-vs-bill timing
                  history. Once at least 30 paid bills accumulate, the
                  system automatically upgrades to a random-forest model
                  trained on those pairs.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-0 border-t border-subtle sm:grid-cols-4">
          {([7, 14, 30, 60] as const).map((h, i) => (
            <div
              key={h}
              className={`px-6 py-6 ${
                i > 0
                  ? "border-t sm:border-l sm:border-t-0 border-subtle"
                  : ""
              } ${i >= 2 ? "border-t sm:border-t-0" : ""}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                Next {h} days
              </div>
              <div className="tabular mt-3 text-[28px] font-semibold leading-none tracking-tight text-ink">
                <span className="mr-1 text-[18px] font-light text-ink-3">₹</span>
                {formatINRCompact(forecast.horizons[h]).replace("₹", "")}
              </div>
              <div className="mt-2 text-[11.5px] text-ink-3">
                {totalOutstanding > 0
                  ? `${((forecast.horizons[h] / totalOutstanding) * 100).toFixed(0)}% of book`
                  : "No open book"}
              </div>
            </div>
          ))}
        </div>

        {/* Debtor-wise drill-down — explains where the aggregate
            horizon numbers come from, and overlays the ML days-to-pay
            prediction so partners can decide credit-term policy per
            debtor, not just chase "the top 5." */}
        {drillRows.length > 0 && (
          <ForecastDrillDown
            rows={drillRows}
            total30={forecast.horizons[30]}
            totalOutstanding={totalOutstanding}
          />
        )}

        {/* Model provenance — shows under-the-hood details so partners
            can answer "why these numbers" if the manager probes. */}
        {forecastMeta.method === "random_forest" && (
          <div className="border-t border-subtle bg-[var(--color-surface-2)] px-10 py-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[11.5px] text-ink-3">
              <span>
                Models:{" "}
                <span className="font-semibold text-ink-2">
                  Random Forest Classifier (per-horizon) + Regressor (days-to-pay) · 80 trees each
                </span>
              </span>
              <span>
                Trained on{" "}
                <span className="font-semibold text-ink-2">
                  {forecastMeta.samples.toLocaleString("en-IN")} historical bills
                </span>
              </span>
              {forecastMeta.trainedAt && (
                <span>
                  Last retrained{" "}
                  <span className="font-semibold text-ink-2">
                    {formatDistanceToNow(forecastMeta.trainedAt, {
                      addSuffix: true,
                    })}
                  </span>
                </span>
              )}
              {forecastMeta.topFeaturesFor30.length > 0 && (
                <span>
                  Top signals:{" "}
                  <span className="font-semibold text-ink-2">
                    {forecastMeta.topFeaturesFor30
                      .filter((f) => f.weight > 0)
                      .slice(0, 3)
                      .map((f) => f.name.replace(/_/g, " "))
                      .join(" · ") || "ageing, amount, velocity"}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
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
            <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink-3">
              Single glance at how much of the book sits in each bucket. Hover
              any segment to isolate it.
            </p>
          </div>
        </div>
        <StackedBar segments={ageingData} />
      </section>

      {/* At-risk debtors — broken promises + 90+ overdue */}
      {atRiskRows.length > 0 && (
        <section
          className="card-apple overflow-hidden"
          style={{
            borderLeft: "3px solid #c4483c",
          }}
        >
          <div className="px-10 pt-8 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#c4483c]">
              At risk
            </p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
              Debtors with broken promises + 90+ overdue
            </h2>
            <p className="mt-1 text-[14px] text-ink-3">
              These debtors have broken at least two payment commitments and
              still have bills in the oldest ageing bucket. Worth a phone call,
              not just another reminder.
            </p>
          </div>
          <ol className="border-t border-subtle">
            {atRiskRows.map((r, i) => (
              <li
                key={r.id}
                className={`flex items-center justify-between px-10 py-4 ${i > 0 ? "border-t border-subtle" : ""}`}
              >
                <div className="min-w-0">
                  <Link
                    href={`/clients/${r.clientCompanyId}`}
                    className="text-[15px] font-medium text-ink hover:underline"
                  >
                    {r.name}
                  </Link>
                  <div className="text-[12px] text-ink-3">
                    {r.clientCompanyName} · {r.brokenPromises} broken promise
                    {r.brokenPromises === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="tabular text-right text-[15px] font-semibold text-ink">
                  {formatINR(r.closingBalance)}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Duplicate cross-client exposure */}
      <DuplicateExposure groups={dupGroups} />

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
            <p className="mt-1.5 text-[15px] text-ink-3">
              Ranked in SQL by total outstanding · refreshes on every load.
            </p>
          </div>
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-[14px] font-medium text-[var(--color-accent-blue)] transition-colors hover:text-[var(--color-accent-blue-hover)]"
          >
            All clients
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {topClientsRanked.length === 0 ? (
          <div className="border-t border-subtle px-10 py-16 text-center">
            <p className="text-[16px] text-ink-2">No client data yet.</p>
            <p className="mt-1 text-[14px] text-ink-3">
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

                  {/* Initials avatar — uniform ink monogram for a
                      restrained, institutional look */}
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[13px] font-medium tracking-wide"
                    style={{
                      background: "#1d1d1f",
                      color: "#f5f5f4",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(29,29,31,0.06)",
                    }}
                    aria-hidden
                  >
                    {initials}
                  </div>

                  {/* Name + debtor count + bar */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <div className="truncate text-[16px] font-medium text-ink group-hover:text-[var(--color-accent-blue)]">
                        {c.name}
                      </div>
                      <div className="tabular shrink-0 text-[16px] font-semibold text-ink">
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
                              c.overdue > 0 ? "#b91c1c" : "#1d1d1f",
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

      {/* Jobs health — ops tile, last run per background job */}
      <section className="card-apple overflow-hidden">
        <div className="px-10 pt-8 pb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Infrastructure
          </p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            Background jobs
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-ink-3">
            Confirms every scheduled job is running. If a row shows FAILED
            or a stale timestamp, the cron hasn&apos;t reached Ledger today.
          </p>
        </div>
        <div className="border-t border-subtle divide-y divide-subtle">
          {jobRows.map((j) => {
            const r = j.run;
            const tone = !r
              ? { label: "NEVER RUN", color: "#86868b", bg: "rgba(134,134,139,0.08)" }
              : r.status === "OK"
                ? { label: "OK", color: "#1f7a4a", bg: "rgba(48,209,88,0.10)" }
                : r.status === "FAILED"
                  ? { label: "FAILED", color: "#c6373a", bg: "rgba(255,69,58,0.08)" }
                  : { label: "RUNNING", color: "#0057b7", bg: "rgba(0,113,227,0.08)" };
            return (
              <div
                key={j.id}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 px-10 py-4"
              >
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-ink">
                    {j.label}
                  </div>
                  <div className="text-[11.5px] text-ink-3">{j.id}</div>
                </div>
                <span
                  className="pill tabular"
                  style={{ background: tone.bg, color: tone.color }}
                >
                  {tone.label}
                </span>
                <div className="tabular text-right text-[13px] text-ink-3">
                  {r
                    ? formatDistanceToNow(r.startedAt, { addSuffix: true })
                    : "—"}
                </div>
                <div className="tabular text-right text-[12px] text-ink-3 min-w-[120px]">
                  {r && r.status === "OK" && (
                    <>
                      {r.rowsAffected} row{r.rowsAffected === 1 ? "" : "s"}
                      {r.durationMs != null && (
                        <span className="ml-2 text-ink-3/70">
                          · {(r.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </>
                  )}
                  {r?.status === "FAILED" && r.error && (
                    <span
                      className="truncate block max-w-[200px]"
                      title={r.error}
                      style={{ color: "#c6373a" }}
                    >
                      {r.error.split("\n")[0].slice(0, 60)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
