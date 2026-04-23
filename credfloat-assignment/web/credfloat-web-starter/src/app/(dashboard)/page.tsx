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
import { groupDuplicates, type DupCandidate } from "@/lib/duplicates";
import { formatDistanceToNow } from "date-fns";

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
