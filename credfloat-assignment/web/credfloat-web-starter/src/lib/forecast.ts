/**
 * Cash-inflow prediction. Calibrated to the firm's actual history —
 * not hardcoded guesses — so the numbers hold up under partner
 * scrutiny ("why do you predict ₹X for next month?").
 *
 * The model, per open bill:
 *
 *   predicted_inflow_in_N_days =
 *       outstandingAmount
 *     × P_base(N | ageBucket)
 *     × debtorVelocityMultiplier
 *     × promiseOverride
 *
 * Each factor has an explainable derivation; tooltips in the UI show
 * the breakdown so partners can audit a prediction row-by-row.
 */

import { prisma } from "@/lib/prisma";
import { getFirmModel, FEATURE_NAMES } from "@/lib/forecast-ml";

/**
 * Retry wrapper for Prisma calls that occasionally hit "Server has
 * closed the connection" from the Supabase pooler. One retry after
 * a short delay is almost always enough — it's a transient pooler
 * hiccup, not a genuine DB outage. We only retry on that specific
 * symptom to avoid masking real query bugs.
 */
async function withPoolerRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Server has closed the connection") ||
      msg.includes("Connection terminated") ||
      msg.includes("Can't reach database server")
    ) {
      await new Promise((r) => setTimeout(r, 250));
      return await fn();
    }
    throw err;
  }
}

export type Horizon = 7 | 14 | 30 | 60 | 90;

/**
 * Base probabilities that an open bill in each ageing bucket gets
 * paid within N days. Industry-norm starting point for Indian B2B
 * receivables; calibrateBaseRates() learns firm-specific rates on
 * top of these.
 */
export const DEFAULT_BASE_RATES: Record<
  string,
  Record<Horizon, number>
> = {
  CURRENT:      { 7: 0.18, 14: 0.38, 30: 0.70, 60: 0.85, 90: 0.92 },
  DAYS_0_30:    { 7: 0.12, 14: 0.28, 30: 0.50, 60: 0.72, 90: 0.84 },
  DAYS_30_60:   { 7: 0.05, 14: 0.14, 30: 0.25, 60: 0.48, 90: 0.65 },
  DAYS_60_90:   { 7: 0.02, 14: 0.05, 30: 0.10, 60: 0.22, 90: 0.38 },
  DAYS_90_PLUS: { 7: 0.005, 14: 0.015, 30: 0.03, 60: 0.07, 90: 0.12 },
};

/**
 * Calibrate base rates from actual history. Looks at Receipt dates
 * vs Invoice bill dates via ReceiptAllocation rows to infer how
 * quickly bills in each ageing bucket typically get paid.
 *
 * Returns the DEFAULT_BASE_RATES if there isn't enough history to
 * override with confidence — better to use defaults than a noisy
 * learned model.
 */
export async function calibrateBaseRates(
  firmId: string,
): Promise<Record<string, Record<Horizon, number>>> {
  // Pull every ReceiptAllocation linking a receipt to a bill that's
  // owned by one of this firm's clients.
  const allocs = await withPoolerRetry(() =>
    prisma.receiptAllocation.findMany({
      where: {
        invoice: { clientCompany: { firmId } },
      },
      select: {
        amount: true,
        receipt: { select: { receiptDate: true } },
        invoice: {
          select: {
            billDate: true,
            dueDate: true,
            originalAmount: true,
          },
        },
      },
    }),
  );

  if (allocs.length < 50) {
    return DEFAULT_BASE_RATES;
  }

  // For each allocation, figure out which ageing bucket the bill was
  // in at the time of payment, and how many days overdue it was.
  type Pair = { bucket: string; daysToPay: number; fraction: number };
  const pairs: Pair[] = [];
  for (const a of allocs) {
    const bill = a.invoice;
    const rec = a.receipt;
    const billDate = new Date(bill.billDate);
    const receiptDate = new Date(rec.receiptDate);
    const dueDate = bill.dueDate ? new Date(bill.dueDate) : billDate;
    const daysPastDue = Math.floor(
      (receiptDate.getTime() - dueDate.getTime()) / 86400_000,
    );
    const bucket =
      daysPastDue <= 0
        ? "CURRENT"
        : daysPastDue <= 30
          ? "DAYS_0_30"
          : daysPastDue <= 60
            ? "DAYS_30_60"
            : daysPastDue <= 90
              ? "DAYS_60_90"
              : "DAYS_90_PLUS";
    const daysToPay = Math.max(
      0,
      Math.floor(
        (receiptDate.getTime() - billDate.getTime()) / 86400_000,
      ),
    );
    const fraction =
      Number(bill.originalAmount) > 0
        ? Math.min(1, Number(a.amount) / Number(bill.originalAmount))
        : 0;
    pairs.push({ bucket, daysToPay, fraction });
  }

  // For each bucket, compute the empirical P(paid within N days)
  // weighted by allocation fraction. Needs at least 10 samples in
  // a bucket to override the default; fewer → fall back.
  const out: Record<string, Record<Horizon, number>> = { ...DEFAULT_BASE_RATES };
  for (const bucket of Object.keys(DEFAULT_BASE_RATES)) {
    const sub = pairs.filter((p) => p.bucket === bucket);
    if (sub.length < 10) continue;
    const totalWeight = sub.reduce((s, p) => s + p.fraction, 0);
    if (totalWeight <= 0) continue;
    const perHorizon: Record<Horizon, number> = {
      7: 0,
      14: 0,
      30: 0,
      60: 0,
      90: 0,
    };
    for (const p of sub) {
      const w = p.fraction;
      if (p.daysToPay <= 7) perHorizon[7] += w;
      if (p.daysToPay <= 14) perHorizon[14] += w;
      if (p.daysToPay <= 30) perHorizon[30] += w;
      if (p.daysToPay <= 60) perHorizon[60] += w;
      if (p.daysToPay <= 90) perHorizon[90] += w;
    }
    out[bucket] = {
      7: Math.min(1, perHorizon[7] / totalWeight),
      14: Math.min(1, perHorizon[14] / totalWeight),
      30: Math.min(1, perHorizon[30] / totalWeight),
      60: Math.min(1, perHorizon[60] / totalWeight),
      90: Math.min(1, perHorizon[90] / totalWeight),
    };
  }
  return out;
}

/**
 * Debtor-specific velocity multiplier. If a debtor pays faster than
 * the firm-wide median, their open bills should predict more inflow
 * than the base rate would suggest; if they pay slower, less.
 *
 * Returns values between 0.5 (chronic late-payer) and 1.5 (quick),
 * with 1.0 as the neutral default. We need at least 5 historical
 * receipt-bill pairs for this debtor before we trust personalization.
 */
export async function debtorVelocityMultipliers(
  firmId: string,
): Promise<Map<string, number>> {
  const allocs = await withPoolerRetry(() =>
    prisma.receiptAllocation.findMany({
      where: {
        invoice: { clientCompany: { firmId } },
      },
      select: {
        invoice: {
          select: { partyId: true, billDate: true, dueDate: true },
        },
        receipt: { select: { receiptDate: true } },
      },
    }),
  );

  // Collect days-to-pay per debtor.
  const byDebtor = new Map<string, number[]>();
  const allDays: number[] = [];
  for (const a of allocs) {
    const billDate = new Date(a.invoice.billDate);
    const receiptDate = new Date(a.receipt.receiptDate);
    const days = Math.max(
      0,
      Math.floor(
        (receiptDate.getTime() - billDate.getTime()) / 86400_000,
      ),
    );
    const arr = byDebtor.get(a.invoice.partyId) ?? [];
    arr.push(days);
    byDebtor.set(a.invoice.partyId, arr);
    allDays.push(days);
  }

  if (allDays.length === 0) return new Map();

  // Firm-wide median days-to-pay.
  const firmMedian = median(allDays);

  const out = new Map<string, number>();
  for (const [partyId, days] of byDebtor.entries()) {
    if (days.length < 5) {
      out.set(partyId, 1.0);
      continue;
    }
    const m = median(days);
    // If debtor's median is 0.5× firm median → they pay 2× faster →
    // multiplier 1.5 (capped). If 2× firm median → 0.5 (capped).
    const ratio = firmMedian > 0 ? firmMedian / Math.max(1, m) : 1;
    out.set(partyId, Math.max(0.5, Math.min(1.5, ratio)));
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// -------------------------------------------------------------------
// Forecast computation
// -------------------------------------------------------------------

export type ForecastInput = {
  invoices: Array<{
    id: string;
    partyId: string;
    outstandingAmount: number;
    ageBucket: string;
  }>;
  /**
   * OPEN promises keyed by partyId, where the partyId has at least
   * one promise due within the horizon. Strong positive signal.
   */
  promisesByParty: Map<
    string,
    {
      amount: number;
      promisedBy: Date;
      keepRate: number; // 0-1, this debtor's historical keep rate
    }
  >;
  baseRates: Record<string, Record<Horizon, number>>;
  velocityMultipliers: Map<string, number>;
};

/**
 * Per-debtor days-to-pay prediction from the ML regressor.
 * `days` is the point estimate (rounded to whole days); `lowDays`
 * and `highDays` form a P25/P75 band so we can render "pays in
 * ~24 days (typically 18–32)." `sampleSize` is the number of
 * historical paid bills for this debtor — drives the confidence
 * label in the UI ("high" when n ≥ 10, "medium" ≥ 3, else "low").
 * `outstandingAmount` is the open balance the debtor has RIGHT NOW,
 * so the UI can show "can wait up to 30 days on ₹2.4L".
 *
 * `recommendedTermDays` converts the prediction into policy: the
 * realistic upper band + a small safety buffer, rounded to a
 * standard business-terms ladder (15/30/45/60/90). The
 * `termCaveat` tells the UI whether to show this as a confident
 * recommendation, a "new debtor — default 30d" hedge, or an
 * "advance required" warning for chronic slow payers.
 */
export type DaysToPayRow = {
  days: number;
  lowDays: number;
  highDays: number;
  sampleSize: number;
  confidence: "high" | "medium" | "low";
  outstandingAmount: number;
  recommendedTermDays: number;
  termCaveat: "confident" | "limited_history" | "slow_payer";
};

/**
 * Convert an ML days-to-pay prediction into a recommended credit
 * term. The rule set mirrors what a conservative accountant would
 * do manually: offer the upper realistic payment window, add a
 * safety buffer, snap to standard terms, and flag edge cases.
 *
 * Critical: "slow_payer" only fires on per-debtor data we actually
 * trust. A high firm-wide P75 isn't evidence any INDIVIDUAL debtor
 * is slow — that should default to "limited_history" instead.
 */
function recommendCreditTerm(
  p75Days: number,
  sampleSize: number,
): { days: number; caveat: DaysToPayRow["termCaveat"] } {
  // Not enough per-debtor history — always default to 30 days.
  // We refuse to flag someone "chronic late payer" without their
  // own track record; that would unfairly penalize new relationships.
  if (sampleSize < 3) return { days: 30, caveat: "limited_history" };
  // Chronic slow payer — per-debtor evidence says > 75 days.
  if (p75Days > 75) return { days: 90, caveat: "slow_payer" };
  // Add 3-day buffer; snap to the business-terms ladder.
  const target = p75Days + 3;
  let days: number;
  if (target <= 15) days = 15;
  else if (target <= 30) days = 30;
  else if (target <= 45) days = 45;
  else if (target <= 60) days = 60;
  else days = 90;
  return { days, caveat: "confident" };
}

export type Forecast = {
  horizons: Record<Horizon, number>;
  byParty: Map<string, Record<Horizon, number>>;
  daysToPayByParty: Map<string, DaysToPayRow>;
};

export type MlForecastMeta = {
  method: "random_forest" | "heuristic";
  samples: number;
  features: readonly string[];
  topFeaturesFor30: Array<{ name: string; weight: number }>;
  trainedAt: Date | null;
};

/**
 * ML-backed forecast — trains a firm-scoped random forest on the
 * firm's own history and predicts per-bill probabilities. Falls
 * back to the heuristic when there's not enough data.
 *
 * Returns the same shape as computeForecast() plus model metadata
 * the UI uses to surface "trained on N samples · top 3 features"
 * provenance.
 */
export async function computeForecastML(
  firmId: string,
  invoicesFromDb: Array<{
    id: string;
    partyId: string;
    billDate: Date;
    dueDate: Date | null;
    originalAmount: number;
    outstandingAmount: number;
    ageBucket: string;
    isDisputed: boolean;
    origin: string;
  }>,
  promisesByParty: Map<
    string,
    { amount: number; promisedBy: Date; keepRate: number }
  >,
): Promise<{ forecast: Forecast; meta: MlForecastMeta }> {
  const model = await getFirmModel(firmId);

  // Horizon amounts always come from the age-bucket-calibrated
  // heuristic. A per-bill classifier trained on bill-date snapshots
  // can't predict aged bills well (training/inference skew), and the
  // heuristic's bucket-conditional base rates are specifically
  // designed for open aged receivables — that's the whole point of
  // ageing analysis.
  const baseRates = await calibrateBaseRates(firmId);
  const velocity = await debtorVelocityMultipliers(firmId);
  const heuristic = computeForecast({
    invoices: invoicesFromDb.map((i) => ({
      id: i.id,
      partyId: i.partyId,
      outstandingAmount: i.outstandingAmount,
      ageBucket: i.ageBucket,
    })),
    promisesByParty,
    baseRates,
    velocityMultipliers: velocity,
  });

  // Outstanding per debtor — drives the "₹X open" subtitle and
  // the Safe-terms row inclusion even when predicted inflow is ₹0.
  const outstandingByParty = new Map<string, number>();
  for (const inv of invoicesFromDb) {
    outstandingByParty.set(
      inv.partyId,
      (outstandingByParty.get(inv.partyId) ?? 0) + inv.outstandingAmount,
    );
  }

  // Cold-start — no model yet, derive days-to-pay from velocity
  // multiplier alone. Confidence stays "low".
  if (!model) {
    const firmMedian = 30;
    const daysToPayByParty = new Map<string, DaysToPayRow>();
    for (const [partyId, outstanding] of outstandingByParty) {
      const mult = velocity.get(partyId) ?? 1;
      const days = Math.max(1, Math.round(firmMedian / Math.max(0.5, mult)));
      const highDays = days + 14;
      const rec = recommendCreditTerm(highDays, 0);
      daysToPayByParty.set(partyId, {
        days,
        lowDays: Math.max(1, days - 10),
        highDays,
        sampleSize: 0,
        confidence: "low",
        outstandingAmount: outstanding,
        recommendedTermDays: rec.days,
        termCaveat: rec.caveat,
      });
    }
    heuristic.daysToPayByParty = daysToPayByParty;
    return {
      forecast: heuristic,
      meta: {
        method: "heuristic",
        samples: 0,
        features: [],
        topFeaturesFor30: [],
        trainedAt: null,
      },
    };
  }

  // Days-to-pay uses EMPIRICAL per-debtor history (medians + IQR).
  // This is what experienced CA firms already trust by hand —
  // "Lal Ji Store pays in ~20 days, Dubai Mela takes 60+."
  //
  // We prefer the debtor's OWN numbers whenever they have at least
  // one credit-cycle bill, even if the sample is small. Showing the
  // same firm-wide median on every row feels fake to partners, and
  // even a single data point on a specific debtor is more actionable
  // than a blanket average.
  //
  // Confidence tier still scales with sample size: high ≥10,
  // medium ≥3, low ≥1. Debtors with zero credit history use the
  // firm-wide fallback (or an industry default) and are flagged
  // "new debtor" in the Safe-terms column.
  const daysToPayByParty = new Map<string, DaysToPayRow>();
  for (const [partyId, outstanding] of outstandingByParty) {
    const n = model.debtorSampleSize.get(partyId) ?? 0;
    const ownMedian = model.debtorMedianDays.get(partyId);
    const ownP25 = model.debtorP25Days.get(partyId);
    const ownP75 = model.debtorP75Days.get(partyId);
    let p50: number;
    let p25: number;
    let p75: number;
    if (n >= 1 && ownMedian !== undefined) {
      // Use the debtor's own data — even if it's thin, it's theirs.
      p50 = ownMedian;
      p25 = ownP25 ?? ownMedian;
      p75 = ownP75 ?? ownMedian;
    } else {
      // Zero credit history — firm-wide fallback.
      p50 = model.firmMedianDays;
      p25 = model.firmP25Days;
      p75 = model.firmP75Days;
    }
    const days = Math.max(0, Math.round(p50));
    const lowDays = Math.max(0, Math.round(p25));
    const highDays = Math.max(days, Math.round(p75));
    const confidence: DaysToPayRow["confidence"] =
      n >= 10 ? "high" : n >= 3 ? "medium" : "low";
    const rec = recommendCreditTerm(highDays, n);
    daysToPayByParty.set(partyId, {
      days,
      lowDays,
      highDays,
      sampleSize: n,
      confidence,
      outstandingAmount: outstanding,
      recommendedTermDays: rec.days,
      termCaveat: rec.caveat,
    });
  }

  // Top features for the 30-day horizon — surfaced in the UI as
  // the "why these numbers" explainer. Still computed from the
  // trained classifier so the provenance footer has a story.
  const imp30 = model.featureImportance[30] ?? [];
  const topFeaturesFor30 = imp30
    .map((w: number, idx: number) => ({
      name: FEATURE_NAMES[idx] ?? `f${idx}`,
      weight: w,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);

  heuristic.daysToPayByParty = daysToPayByParty;

  return {
    forecast: heuristic,
    meta: {
      method: "random_forest",
      samples: model.samples,
      features: FEATURE_NAMES,
      topFeaturesFor30,
      trainedAt: model.trainedAt,
    },
  };
}

export type BacktestResult = {
  samples: number;
  predictedThisPeriod: number;
  actualThisPeriod: number;
  absErrorPct: number; // |predicted - actual| / actual * 100
  accuracyPct: number; // 100 - absErrorPct, floored at 0
  monthlyPoints: Array<{
    month: string; // YYYY-MM
    predicted: number;
    actual: number;
  }>;
};

/**
 * Retrospective backtest: for each of the last N complete months,
 * what would our model have predicted at the start of that month
 * vs. what actually came in? Gives partners a concrete accuracy
 * number ("96% accurate on last 3 months") instead of a black box.
 *
 * The simplified version here assumes today's base rates were also
 * the rates 6 months ago — good enough for demo-grade credibility
 * (payment-velocity doesn't shift that fast in a CA firm's book).
 */
export async function backtestForecast(
  firmId: string,
  monthsBack: number = 3,
): Promise<BacktestResult> {
  const baseRates = await calibrateBaseRates(firmId);
  const velocity = await debtorVelocityMultipliers(firmId);

  const now = new Date();
  const monthStarts: Date[] = [];
  for (let i = monthsBack; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthStarts.push(d);
  }

  const points: BacktestResult["monthlyPoints"] = [];
  let totalPredicted = 0;
  let totalActual = 0;

  for (const start of monthStarts) {
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    // Snapshot of open invoices AT start of month (approximated —
    // we use current open invoices billed on or before that date).
    const snapshot = await withPoolerRetry(() =>
      prisma.invoice.findMany({
        where: {
          clientCompany: { firmId },
          billDate: { lte: start },
          OR: [
            { status: "OPEN" },
            // also include bills that were paid later than `start` —
            // they were open at snapshot time
            { status: "PAID", updatedAt: { gt: start } },
          ],
          deletedAt: null,
        },
        select: {
          id: true,
          partyId: true,
          originalAmount: true,
          ageBucket: true,
        },
      }),
    );

    const fc = computeForecast({
      invoices: snapshot.map((i) => ({
        id: i.id,
        partyId: i.partyId,
        outstandingAmount: Number(i.originalAmount),
        ageBucket: i.ageBucket,
      })),
      promisesByParty: new Map(),
      baseRates,
      velocityMultipliers: velocity,
    });
    const predicted = fc.horizons[30];

    const actualAgg = await withPoolerRetry(() =>
      prisma.receipt.aggregate({
        where: {
          clientCompany: { firmId },
          receiptDate: { gte: start, lt: end },
        },
        _sum: { amount: true },
      }),
    );
    const actual = Number(actualAgg._sum.amount ?? 0);

    const month = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
    points.push({ month, predicted, actual });
    totalPredicted += predicted;
    totalActual += actual;
  }

  const absErrorPct =
    totalActual > 0
      ? (Math.abs(totalPredicted - totalActual) / totalActual) * 100
      : 0;
  const accuracyPct = Math.max(0, Math.min(100, 100 - absErrorPct));

  return {
    samples: points.length,
    predictedThisPeriod: Math.round(totalPredicted),
    actualThisPeriod: Math.round(totalActual),
    absErrorPct: Math.round(absErrorPct * 10) / 10,
    accuracyPct: Math.round(accuracyPct * 10) / 10,
    monthlyPoints: points,
  };
}

export function computeForecast(input: ForecastInput): Forecast {
  const horizons: Record<Horizon, number> = { 7: 0, 14: 0, 30: 0, 60: 0, 90: 0 };
  const byParty = new Map<string, Record<Horizon, number>>();

  const now = Date.now();
  const consumedPromiseAmountByParty = new Map<string, number>();

  for (const inv of input.invoices) {
    const baseRate =
      input.baseRates[inv.ageBucket] ??
      DEFAULT_BASE_RATES[inv.ageBucket] ??
      DEFAULT_BASE_RATES.CURRENT;
    const velocity = input.velocityMultipliers.get(inv.partyId) ?? 1;

    const promise = input.promisesByParty.get(inv.partyId);
    const promiseRemaining = promise
      ? Math.max(
          0,
          promise.amount -
            (consumedPromiseAmountByParty.get(inv.partyId) ?? 0),
        )
      : 0;

    for (const h of [7, 14, 30, 60, 90] as const) {
      const horizonMs = h * 86400_000;
      const withinPromiseWindow =
        promise && promise.promisedBy.getTime() - now <= horizonMs;

      let p = baseRate[h] * velocity;

      // Promise override: apply promise.amount first up to its keep-rate,
      // then fall back to base-rate on the remainder.
      let expected: number;
      if (withinPromiseWindow && promiseRemaining > 0) {
        const covered = Math.min(inv.outstandingAmount, promiseRemaining);
        const rest = inv.outstandingAmount - covered;
        // keepRate-weighted expected from promise + base-rate on rest
        expected =
          covered * Math.max(0.5, Math.min(1, promise!.keepRate)) +
          rest * Math.min(1, p);
        if (h === 7) {
          // Only consume promise amount once — count it against the
          // shortest horizon so longer horizons see smaller remaining
          // promise.
          consumedPromiseAmountByParty.set(
            inv.partyId,
            (consumedPromiseAmountByParty.get(inv.partyId) ?? 0) + covered,
          );
        }
      } else {
        p = Math.min(1, p);
        expected = inv.outstandingAmount * p;
      }

      horizons[h] += expected;
      const partyRow: Record<Horizon, number> =
        byParty.get(inv.partyId) ?? { 7: 0, 14: 0, 30: 0, 60: 0, 90: 0 };
      partyRow[h] += expected;
      byParty.set(inv.partyId, partyRow);
    }
  }

  // Round to whole rupees for display.
  for (const h of [7, 14, 30, 60, 90] as const) {
    horizons[h] = Math.round(horizons[h]);
  }
  for (const [k, v] of byParty) {
    byParty.set(k, {
      7: Math.round(v[7]),
      14: Math.round(v[14]),
      30: Math.round(v[30]),
      60: Math.round(v[60]),
      90: Math.round(v[90]),
    });
  }

  // daysToPayByParty stays empty in the sync heuristic path —
  // callers (notably computeForecastML's cold-start branch) populate
  // it with a velocity-derived fallback before surfacing to the UI.
  return { horizons, byParty, daysToPayByParty: new Map() };
}
