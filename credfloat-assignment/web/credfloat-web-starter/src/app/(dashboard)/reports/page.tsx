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

  // Current week window (IST Monday 00:00 → now)
  const weekStart = new Date(now);
  const dow = weekStart.getDay(); // 0 = Sun
  const daysSinceMon = (dow + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysSinceMon);
  weekStart.setHours(0, 0, 0, 0);

  const [
    ageingBuckets,
    receipts,
    clientReach,
    staffReminders,
    staff,
    promises,
  ] = await Promise.all([
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
    prisma.activityLog.groupBy({
      by: ["actorId"],
      where: {
        firmId,
        action: "reminder.sent_manual",
        createdAt: { gte: weekStart },
        actorId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.firmStaff.findMany({
      where: { firmId },
      select: { id: true, name: true, role: true },
    }),
    prisma.promiseToPay.findMany({
      where: { party: { clientCompany: { firmId } } },
      select: {
        id: true,
        amount: true,
        promisedBy: true,
        status: true,
        party: { select: { id: true, tallyLedgerName: true, clientCompanyId: true } },
      },
      orderBy: { promisedBy: "desc" },
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

  // Staff performance — manual reminders this week
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const staffRows = staffReminders
    .map((r) => {
      const s = r.actorId ? staffById.get(r.actorId) : null;
      return {
        id: r.actorId ?? "unknown",
        name: s?.name ?? "Unknown user",
        role: s?.role ?? "STAFF",
        count: r._count._all,
      };
    })
    .sort((a, b) => b.count - a.count);
  const staffReminderTotal = staffRows.reduce((s, x) => s + x.count, 0);
  const staffMax = staffRows[0]?.count ?? 0;

  // Promise slippage — aggregate & per-party slippage list
  let keptCount = 0;
  let brokenCount = 0;
  let openCount = 0;
  let openOverdueCount = 0;
  const brokenByParty = new Map<
    string,
    {
      partyId: string;
      label: string;
      clientCompanyId: string;
      brokenAmount: number;
      count: number;
      latestPromised: Date;
    }
  >();
  for (const p of promises) {
    if (p.status === "KEPT") keptCount++;
    else if (p.status === "BROKEN") brokenCount++;
    else {
      openCount++;
      if (p.promisedBy < now) openOverdueCount++;
    }
    if (p.status === "BROKEN") {
      const key = p.party.id;
      const prior = brokenByParty.get(key);
      const amt = Number(p.amount);
      if (prior) {
        prior.brokenAmount += amt;
        prior.count += 1;
        if (p.promisedBy > prior.latestPromised) prior.latestPromised = p.promisedBy;
      } else {
        brokenByParty.set(key, {
          partyId: p.party.id,
          label: p.party.tallyLedgerName,
          clientCompanyId: p.party.clientCompanyId,
          brokenAmount: amt,
          count: 1,
          latestPromised: p.promisedBy,
        });
      }
    }
  }
  const promiseKeepRate =
    keptCount + brokenCount === 0
      ? null
      : (keptCount / (keptCount + brokenCount)) * 100;
  const topBrokenPromises = [...brokenByParty.values()]
    .sort((a, b) => b.brokenAmount - a.brokenAmount)
    .slice(0, 8);

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
              <p className="mt-1 text-[14px] text-ink-3">
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
            <p className="mt-1 text-[14px] text-ink-3">
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
                  className="flex items-center justify-between text-[14px]"
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
          <p className="mt-1 max-w-2xl text-[14px] text-ink-3">
            Percentage of each client&apos;s debtor ledgers that have at least
            one digital contact (email, WhatsApp, or phone) on file. The
            unreachable ones need physical mail — or back-office enrichment in
            Tally.
          </p>
        </div>

        {reachabilityRows.length === 0 ? (
          <div className="border-t border-subtle px-8 py-16 text-center">
            <p className="text-[16px] text-ink-2">No client data yet.</p>
            <p className="mt-1 text-[14px] text-ink-3">
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
                    <div className="text-[15px] font-medium text-ink">
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
                      className="tabular text-[15px] font-semibold"
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

      {/* Staff performance + Promise slippage */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="card-apple p-8 lg:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Staff activity
          </p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            Manual reminders this week
          </h2>
          <p className="mt-1 text-[14px] text-ink-3">
            Sends logged since Monday 00:00 IST. Automated cron sends are
            excluded.
          </p>
          <div className="mt-6">
            {staffRows.length === 0 ? (
              <p className="py-8 text-center text-[14px] text-ink-3">
                No manual reminders sent this week.
              </p>
            ) : (
              <div className="space-y-3">
                {staffRows.map((s) => {
                  const pct = staffMax === 0 ? 0 : (s.count / staffMax) * 100;
                  return (
                    <div key={s.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-[14px]">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">
                            {s.name}
                          </span>
                          <span className="rounded-full border border-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-3">
                            {s.role}
                          </span>
                        </div>
                        <span className="tabular text-[14px] font-semibold text-ink">
                          {s.count}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                        <div
                          className="h-full rounded-full bg-[#0a84ff] transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="mt-4 border-t border-subtle pt-3 text-right text-[12px] text-ink-3">
                  Team total:{" "}
                  <span className="tabular font-semibold text-ink">
                    {staffReminderTotal}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="card-apple p-8 lg:col-span-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                Promises
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
                Promise-to-pay slippage
              </h2>
              <p className="mt-1 text-[14px] text-ink-3">
                How often debtors keep their word. Broken promises are the
                leading indicator of a write-off.
              </p>
            </div>
            <div className="text-right">
              <div className="tabular text-[28px] font-semibold text-ink">
                {promiseKeepRate === null
                  ? "—"
                  : `${promiseKeepRate.toFixed(0)}%`}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-ink-3">
                keep rate
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-4 gap-3">
            <div className="rounded-xl border border-subtle bg-[var(--color-surface-3)] p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-3">
                Open
              </div>
              <div className="tabular mt-1 text-[20px] font-semibold text-ink">
                {openCount}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="text-[11px] uppercase tracking-wider text-amber-700">
                Overdue
              </div>
              <div className="tabular mt-1 text-[20px] font-semibold text-amber-800">
                {openOverdueCount}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[11px] uppercase tracking-wider text-emerald-700">
                Kept
              </div>
              <div className="tabular mt-1 text-[20px] font-semibold text-emerald-800">
                {keptCount}
              </div>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <div className="text-[11px] uppercase tracking-wider text-red-700">
                Broken
              </div>
              <div className="tabular mt-1 text-[20px] font-semibold text-red-800">
                {brokenCount}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-3">
              Debtors who&apos;ve broken the most
            </h3>
            {topBrokenPromises.length === 0 ? (
              <p className="mt-4 py-4 text-center text-[14px] text-ink-3">
                No broken promises yet.
              </p>
            ) : (
              <div className="mt-3 divide-y divide-subtle rounded-xl border border-subtle">
                {topBrokenPromises.map((p) => (
                  <a
                    key={p.partyId}
                    href={`/clients/${p.clientCompanyId}?party=${p.partyId}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-ink">
                        {p.label}
                      </div>
                      <div className="text-[11px] text-ink-3">
                        {p.count} broken
                        {p.count === 1 ? " promise" : " promises"} · latest{" "}
                        {p.latestPromised.toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="tabular shrink-0 text-[14px] font-semibold text-red-700">
                      {formatINR(p.brokenAmount)}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
