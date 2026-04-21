import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { formatINR, formatINRCompact } from "@/lib/currency";
import { AGE_BUCKET_LABELS, AGE_BUCKETS_ORDER } from "@/lib/ageing";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const AGEING_COLOR: Record<string, string> = {
  CURRENT: "#30d158",
  DAYS_0_30: "#0a84ff",
  DAYS_30_60: "#ff9f0a",
  DAYS_60_90: "#ff6b3d",
  DAYS_90_PLUS: "#ff453a",
};

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const portal = await prisma.portalToken.findFirst({
    where: { token },
    include: {
      clientCompany: {
        include: {
          parties: {
            where: { closingBalance: { gt: 0 } },
            orderBy: { closingBalance: "desc" },
            take: 10,
          },
          invoices: {
            where: { status: "OPEN" },
            select: { ageBucket: true, outstandingAmount: true },
          },
        },
      },
    },
  });

  if (!portal) notFound();
  if (portal.revokedAt) notFound();
  if (portal.expiresAt && portal.expiresAt < new Date()) notFound();

  // Record usage (fire and forget, non-blocking semantics)
  await prisma.portalToken.update({
    where: { id: portal.id },
    data: { lastUsedAt: new Date() },
  });

  const client = portal.clientCompany;
  // Total dues = sum of positive debtor ledger balances (ledger is the
  // truth; invoice sum can diverge when we missed syncing a receipt).
  const totalOutstanding = client.parties.reduce(
    (s, p) => s + Math.max(0, Number(p.closingBalance)),
    0,
  );

  const byBucket = AGE_BUCKETS_ORDER.map((b) => {
    const value = client.invoices
      .filter((i) => i.ageBucket === b)
      .reduce((s, i) => s + Number(i.outstandingAmount), 0);
    return { key: b, label: AGE_BUCKET_LABELS[b], value, color: AGEING_COLOR[b] };
  });

  const maxParty = Math.max(
    1,
    ...client.parties.map((p) => Number(p.closingBalance)),
  );

  return (
    <div className="min-h-screen bg-surface">
      {/* Portal banner */}
      <div
        className="relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(0,113,227,0.08), rgba(191,90,242,0.06) 60%, rgba(48,209,88,0.04))",
        }}
      >
        <div className="mx-auto max-w-4xl px-6 py-14">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg"
              style={{
                background:
                  "linear-gradient(135deg, #0a84ff, #0071e3 50%, #0040dd)",
                boxShadow:
                  "0 2px 8px -2px rgba(0,113,227,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7c0-1.1.9-2 2-2h10l4 4v8c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V7z"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-[14px] font-semibold text-ink">Ledger</span>
            <span className="text-ink-3">·</span>
            <span className="text-[13px] text-ink-2">Client portal</span>
          </div>

          <p className="mt-10 text-[12px] font-semibold uppercase tracking-[0.16em] text-ink-3">
            Your receivables · {client.displayName}
          </p>
          <h1 className="mt-3 font-semibold leading-[1.05] tracking-tightest text-ink"
              style={{ fontSize: "clamp(44px, 6vw, 72px)" }}>
            <span style={{ opacity: 0.5, fontWeight: 300, marginRight: "0.08em" }}>
              ₹
            </span>
            <span className="tabular">
              {Number(totalOutstanding).toLocaleString("en-IN")}
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-2">
            is currently outstanding across your book. DPS &amp; Co is actively
            working on collection via automated reminders and follow-ups.
          </p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Last refreshed{" "}
            {formatInTimeZone(
              new Date(),
              "Asia/Kolkata",
              "dd MMM yyyy, HH:mm 'IST'",
            )}
            .
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-10 px-6 py-12">
        {/* Ageing breakdown */}
        <section className="card-apple p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Ageing
          </p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            How your receivables are ageing
          </h2>
          <p className="mt-1 text-[14px] text-ink-3">
            Outstanding split by days since due date.
          </p>

          <div className="mt-6 space-y-5">
            {byBucket.map((b) => {
              const pct = totalOutstanding === 0
                ? 0
                : (b.value / totalOutstanding) * 100;
              return (
                <div key={b.key}>
                  <div className="mb-2 flex items-baseline justify-between text-[14px]">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ background: b.color }}
                      />
                      <span className="text-ink-2">{b.label}</span>
                    </div>
                    <div className="tabular">
                      <span className="font-semibold text-ink">
                        {formatINR(b.value)}
                      </span>
                      <span className="ml-2 text-[11.5px] text-ink-3">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                      style={{ width: `${pct}%`, background: b.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Top debtors */}
        <section className="card-apple overflow-hidden">
          <div className="px-8 pt-7 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Top debtors
            </p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
              Where most of your outstanding sits
            </h2>
            <p className="mt-1 text-[14px] text-ink-3">
              Top 10 debtors by balance. Reminders are dispatched automatically
              on the schedule DPS &amp; Co has configured for you.
            </p>
          </div>
          {client.parties.length === 0 ? (
            <div className="border-t border-subtle px-8 py-16 text-center">
              <p className="text-[15px] font-medium text-ink">
                No outstanding debtors
              </p>
              <p className="mt-1 text-[13px] text-ink-3">
                Every ledger has a zero or credit balance right now.
              </p>
            </div>
          ) : (
            <div className="border-t border-subtle">
              {client.parties.map((p, i) => {
                const amount = Number(p.closingBalance);
                const pct = (amount / maxParty) * 100;
                const initials = (p.mailingName || p.tallyLedgerName)
                  .split(" ")
                  .slice(0, 2)
                  .map((w) => w[0])
                  .join("")
                  .toUpperCase();
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-5 px-8 py-4 ${i > 0 ? "border-t border-subtle" : ""}`}
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-white"
                      style={{
                        background: `linear-gradient(135deg, hsl(${(i * 47) % 360} 70% 55%), hsl(${(i * 47 + 30) % 360} 80% 45%))`,
                      }}
                      aria-hidden
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-4">
                        <div className="truncate text-[15px] font-medium text-ink">
                          {p.mailingName || p.tallyLedgerName}
                        </div>
                        <div className="tabular shrink-0 text-[15px] font-semibold text-ink">
                          {formatINR(amount)}
                        </div>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background:
                              "linear-gradient(90deg, #0a84ff, #5e5ce6)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Compact explainer */}
        <section className="rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]/50 p-6 text-[13.5px] leading-relaxed text-ink-2">
          This is a read-only link to your receivables, generated by DPS &amp;
          Co. Nothing here is editable. Reminders to your debtors are sent by
          Ledger on your behalf according to the schedule your firm has set.{" "}
          {portal.expiresAt && (
            <>
              This link expires on{" "}
              <span className="font-medium text-ink">
                {formatInTimeZone(
                  portal.expiresAt,
                  "Asia/Kolkata",
                  "dd MMM yyyy",
                )}
              </span>
              .
            </>
          )}
        </section>

        <footer className="text-center text-[11.5px] text-ink-3">
          Powered by Ledger · an internal tool by DPS &amp; Co
        </footer>
      </div>
    </div>
  );
}
