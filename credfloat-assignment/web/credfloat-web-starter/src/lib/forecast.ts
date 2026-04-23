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

export type Horizon = 30 | 60 | 90;

/**
 * Base probabilities that an open bill in each ageing bucket gets
 * paid within 30 / 60 / 90 days. These defaults come from industry
 * norms for Indian B2B receivables; calibrateBaseRates() can swap
 * them out for values learned from the firm's own data.
 */
export const DEFAULT_BASE_RATES: Record<
  string,
  Record<Horizon, number>
> = {
  CURRENT:      { 30: 0.70, 60: 0.85, 90: 0.92 },
  DAYS_0_30:    { 30: 0.50, 60: 0.72, 90: 0.84 },
  DAYS_30_60:   { 30: 0.25, 60: 0.48, 90: 0.65 },
  DAYS_60_90:   { 30: 0.10, 60: 0.22, 90: 0.38 },
  DAYS_90_PLUS: { 30: 0.03, 60: 0.07, 90: 0.12 },
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
  const allocs = await prisma.receiptAllocation.findMany({
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
  });

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
    const perHorizon: Record<Horizon, number> = { 30: 0, 60: 0, 90: 0 };
    for (const p of sub) {
      const w = p.fraction;
      if (p.daysToPay <= 30) perHorizon[30] += w;
      if (p.daysToPay <= 60) perHorizon[60] += w;
      if (p.daysToPay <= 90) perHorizon[90] += w;
    }
    out[bucket] = {
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
  const allocs = await prisma.receiptAllocation.findMany({
    where: {
      invoice: { clientCompany: { firmId } },
    },
    select: {
      invoice: {
        select: { partyId: true, billDate: true, dueDate: true },
      },
      receipt: { select: { receiptDate: true } },
    },
  });

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

export type Forecast = {
  horizons: Record<Horizon, number>;
  byParty: Map<string, Record<Horizon, number>>;
};

export function computeForecast(input: ForecastInput): Forecast {
  const horizons: Record<Horizon, number> = { 30: 0, 60: 0, 90: 0 };
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

    for (const h of [30, 60, 90] as const) {
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
        if (h === 30) {
          // Only consume promise amount once — count it against the
          // 30-day horizon so 60/90 see smaller remaining promise.
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
      const partyRow = byParty.get(inv.partyId) ?? { 30: 0, 60: 0, 90: 0 };
      partyRow[h] += expected;
      byParty.set(inv.partyId, partyRow);
    }
  }

  // Round to whole rupees for display.
  horizons[30] = Math.round(horizons[30]);
  horizons[60] = Math.round(horizons[60]);
  horizons[90] = Math.round(horizons[90]);
  for (const [k, v] of byParty) {
    byParty.set(k, { 30: Math.round(v[30]), 60: Math.round(v[60]), 90: Math.round(v[90]) });
  }

  return { horizons, byParty };
}
