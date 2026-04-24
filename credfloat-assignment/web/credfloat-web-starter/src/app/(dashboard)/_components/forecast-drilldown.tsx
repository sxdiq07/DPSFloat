"use client";

/**
 * Debtor-wise cash-inflow drill-down.
 *
 * Answers two partner-facing questions the aggregate horizon tiles
 * cannot:
 *
 *   1. "Where is that ₹X coming from?" — per-debtor contribution to
 *      each horizon (7/14/30/60), ranked with a % share of the 30-day
 *      forecast.
 *   2. "How much time can we realistically give them?" — ML-predicted
 *      days-to-pay with a P25/P75 range and a confidence badge driven
 *      by how many historical bills back the estimate.
 *
 * Client component because we want:
 *   - Sort toggle (by expected inflow vs. by days-to-pay)
 *   - Collapse/expand between top 10 and full list without a reload
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Clock, Users } from "lucide-react";
import { formatINR, formatINRCompact } from "@/lib/currency";

export type ForecastDrillRow = {
  partyId: string;
  name: string;
  clientCompanyId: string;
  clientCompanyName: string;
  amounts: {
    7: number;
    14: number;
    30: number;
    60: number;
  };
  /** ML-predicted days-to-pay + P25/P75 band. Null when unavailable. */
  daysToPay: {
    days: number;
    lowDays: number;
    highDays: number;
    sampleSize: number;
    confidence: "high" | "medium" | "low";
    recommendedTermDays: number;
    termCaveat: "confident" | "limited_history" | "slow_payer";
  } | null;
  outstandingAmount: number;
};

type SortKey = "amount30" | "days" | "outstanding";

export function ForecastDrillDown({
  rows,
  total30,
  totalOutstanding,
}: {
  rows: ForecastDrillRow[];
  total30: number;
  totalOutstanding: number;
}) {
  const [sort, setSort] = useState<SortKey>("amount30");
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    if (sort === "amount30") {
      copy.sort((a, b) => b.amounts[30] - a.amounts[30]);
    } else if (sort === "days") {
      copy.sort(
        (a, b) =>
          (a.daysToPay?.days ?? 99999) - (b.daysToPay?.days ?? 99999),
      );
    } else {
      copy.sort((a, b) => b.outstandingAmount - a.outstandingAmount);
    }
    return copy;
  }, [rows, sort]);

  const visible = showAll ? sorted : sorted.slice(0, 10);

  return (
    <div className="border-t border-subtle px-10 py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Where the 30-day cash is coming from
          </p>
          <h3 className="mt-1 text-[18px] font-semibold tracking-tight text-ink">
            Debtor-wise breakdown
          </h3>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-3">
            Ranked per debtor contribution to the forecast. The{" "}
            <span className="font-medium text-ink-2">Pays in</span> column
            is the ML-predicted days-to-first-payment band;{" "}
            <span className="font-medium text-ink-2">Safe terms</span>{" "}
            converts that into a recommended credit period you can put on
            the next invoice (standard 15/30/45/60/90-day ladder).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-subtle p-0.5 text-[12px]">
            <SortButton active={sort === "amount30"} onClick={() => setSort("amount30")}>
              <ArrowUpDown className="h-3 w-3" />
              30-day inflow
            </SortButton>
            <SortButton active={sort === "days"} onClick={() => setSort("days")}>
              <Clock className="h-3 w-3" />
              Fastest payer
            </SortButton>
            <SortButton
              active={sort === "outstanding"}
              onClick={() => setSort("outstanding")}
            >
              <Users className="h-3 w-3" />
              Biggest balance
            </SortButton>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-subtle">
        <div className="hidden grid-cols-[minmax(0,2fr)_80px_80px_80px_80px_60px_120px_130px] items-center gap-3 bg-[var(--color-surface-2)] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3 md:grid">
          <div>Debtor</div>
          <div className="text-right">7d</div>
          <div className="text-right">14d</div>
          <div className="text-right">30d</div>
          <div className="text-right">60d</div>
          <div className="text-right">% 30d</div>
          <div className="text-right">Pays in</div>
          <div className="text-right">Safe terms</div>
        </div>

        <div className="max-h-[520px] overflow-y-auto divide-y divide-subtle">
          {visible.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-3">
              No open bills — nothing to forecast yet.
            </div>
          ) : (
            visible.map((r) => {
              const share =
                total30 > 0 ? (r.amounts[30] / total30) * 100 : 0;
              return (
                <Link
                  key={r.partyId}
                  href={`/clients/${r.clientCompanyId}`}
                  className="grid grid-cols-[minmax(0,2fr)_80px_80px_80px_80px_60px_120px_130px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)] md:grid"
                  style={{ display: "grid" }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium text-ink">
                      {r.name}
                    </div>
                    <div className="truncate text-[11px] text-ink-3">
                      {r.clientCompanyName} ·{" "}
                      {formatINRCompact(r.outstandingAmount)} open
                    </div>
                  </div>
                  <AmountCell value={r.amounts[7]} />
                  <AmountCell value={r.amounts[14]} />
                  <AmountCell value={r.amounts[30]} emphasize />
                  <AmountCell value={r.amounts[60]} />
                  <div className="text-right text-[12px] tabular text-ink-3">
                    {share > 0.1 ? `${share.toFixed(1)}%` : "—"}
                  </div>
                  <div className="text-right">
                    {r.daysToPay ? (
                      <>
                        <div className="tabular text-[13px] font-semibold text-ink">
                          ~{r.daysToPay.days}d
                        </div>
                        <div className="tabular text-[10.5px] text-ink-3">
                          {r.daysToPay.lowDays}–{r.daysToPay.highDays}d
                          <ConfBadge c={r.daysToPay.confidence} />
                        </div>
                      </>
                    ) : (
                      <div className="text-[12px] text-ink-3">—</div>
                    )}
                  </div>
                  <div className="text-right">
                    {r.daysToPay ? (
                      <SafeTermCell
                        days={r.daysToPay.recommendedTermDays}
                        caveat={r.daysToPay.termCaveat}
                      />
                    ) : (
                      <div className="text-[12px] text-ink-3">—</div>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11.5px] text-ink-3">
        <span>
          Showing {visible.length.toLocaleString("en-IN")} of{" "}
          {rows.length.toLocaleString("en-IN")} debtors
          {totalOutstanding > 0 && (
            <>
              {" · "}
              book at {formatINRCompact(totalOutstanding)}
            </>
          )}
        </span>
        {rows.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-[12px] font-medium text-[var(--color-accent-blue)] hover:underline"
          >
            {showAll ? "Show top 10" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </div>
  );
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active
          ? "bg-ink text-white"
          : "text-ink-3 hover:bg-[var(--color-surface-2)] hover:text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}

function AmountCell({
  value,
  emphasize = false,
}: {
  value: number;
  emphasize?: boolean;
}) {
  if (value <= 0) {
    return <div className="text-right text-[12px] text-ink-3">—</div>;
  }
  return (
    <div
      className={`text-right tabular text-[12.5px] ${emphasize ? "font-semibold text-ink" : "text-ink-2"}`}
    >
      {formatINR(value)}
    </div>
  );
}

/**
 * "Safe terms" recommendation cell. Renders the standard-ladder
 * credit term the model recommends, plus a small caveat line
 * explaining WHY — so a partner reviewing the list knows whether
 * to trust the number or override it.
 */
function SafeTermCell({
  days,
  caveat,
}: {
  days: number;
  caveat: "confident" | "limited_history" | "slow_payer";
}) {
  const cfg = {
    confident: {
      main: `${days} days`,
      sub: "strong history",
      subColor: "#1f7a4a",
      dot: "#1f7a4a",
    },
    limited_history: {
      main: `${days} days`,
      sub: "new debtor",
      subColor: "#86868b",
      dot: "#86868b",
    },
    slow_payer: {
      main: "Advance",
      sub: "chronic late payer",
      subColor: "#c6373a",
      dot: "#c6373a",
    },
  }[caveat];

  return (
    <div
      title={
        caveat === "confident"
          ? `Recommend offering ${days}-day credit terms based on historical payment pattern.`
          : caveat === "limited_history"
            ? "Not enough history to personalize — fall back to standard 30-day terms."
            : "P75 payment window exceeds 75 days — don't extend open credit; ask for advance or milestone payment."
      }
    >
      <div className="tabular text-[13px] font-semibold text-ink">
        {cfg.main}
      </div>
      <div
        className="tabular text-[10.5px] inline-flex items-center gap-1"
        style={{ color: cfg.subColor }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: cfg.dot }}
        />
        {cfg.sub}
      </div>
    </div>
  );
}

function ConfBadge({ c }: { c: "high" | "medium" | "low" }) {
  const cfg = {
    high: { dot: "#1f7a4a", label: "high" },
    medium: { dot: "#0057b7", label: "med" },
    low: { dot: "#86868b", label: "low" },
  }[c];
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-1 align-middle"
      title={`${cfg.label} confidence — based on historical sample size`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: cfg.dot }}
      />
    </span>
  );
}
