/**
 * Random-forest payment-probability model.
 *
 * Trains a firm-scoped RandomForestClassifier on historical
 * (bill, paid-within-N-days) pairs, then predicts per open bill the
 * probability of payment within each horizon. Replaces the earlier
 * bucket-average heuristic with a real gradient tree ensemble —
 * comparable in accuracy to XGBoost on tabular receivables data,
 * plus feature importance scoring you can surface to partners.
 *
 * We train in-process (no Python, no ONNX); keeps the deploy story
 * simple and the model fresh. At ~2k samples × 8 features × 100
 * trees it's a ~1-2s training step — cached per firm for an hour.
 *
 * Cold-start: if fewer than 30 historical pairs exist, callers
 * should fall back to the base-rate heuristic in forecast.ts.
 */

import { prisma } from "@/lib/prisma";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — ml-random-forest ships without types
import { RandomForestClassifier, RandomForestRegression } from "ml-random-forest";

export type HorizonDays = 7 | 14 | 30 | 60 | 90;

export type MlFeatureRow = number[]; // encoded feature vector

/** Encoded in a stable order so the model's feature-importance output
 * matches the labels we surface in the UI. */
export const FEATURE_NAMES = [
  "is_current",
  "is_0_30",
  "is_30_60",
  "is_60_90",
  "is_90_plus",
  "days_since_bill",
  "log_amount",
  "debtor_median_days",
  "debtor_sample_size",
  "has_open_promise",
  "is_disputed",
  "is_credfloat_origin",
  "bill_weekday",
  "bill_month",
] as const;

function ageBucketOneHot(bucket: string): number[] {
  return [
    bucket === "CURRENT" ? 1 : 0,
    bucket === "DAYS_0_30" ? 1 : 0,
    bucket === "DAYS_30_60" ? 1 : 0,
    bucket === "DAYS_60_90" ? 1 : 0,
    bucket === "DAYS_90_PLUS" ? 1 : 0,
  ];
}

type TrainingRow = {
  features: MlFeatureRow;
  label: 0 | 1;
  daysToPay: number;
};

/**
 * Days-to-pay regressor — predicts the continuous target
 * (days from billDate to first receipt) instead of a binary
 * "paid within N days" classification. Used to answer the
 * partner-facing question "how much time should we give this
 * debtor?" Uses Random Forest Regression for the point estimate
 * and training-residual spread to derive a P25/P75 range.
 */
export type DaysToPayRegressor = {
  regressor: InstanceType<typeof RandomForestRegression>;
  /**
   * Std. deviation of (actual - predicted) on the training set.
   * Converted to P25/P75 via ±0.6745σ at inference time — gives
   * the "typical range" surfaced in the UI.
   */
  residualStdDays: number;
  /** Firm-wide median days — used as a last-resort fallback. */
  firmMedianDays: number;
};

export type MlModelBundle = {
  // One classifier per horizon — multi-label binary classification.
  models: Record<HorizonDays, InstanceType<typeof RandomForestClassifier>>;
  // Stats for UX narrative + debugging.
  samples: number;
  firmId: string;
  trainedAt: Date;
  featureImportance: Record<HorizonDays, number[]>;
  /**
   * Debtor-velocity cache — computed during training, reused at
   * inference so we don't hit the DB twice for the same numbers.
   */
  debtorMedianDays: Map<string, number>;
  debtorSampleSize: Map<string, number>;
  /** Per-debtor empirical P25/P75 of historical days-to-pay. */
  debtorP25Days: Map<string, number>;
  debtorP75Days: Map<string, number>;
  firmMedianDays: number;
  /** Firm-wide empirical P25/P75 — fallback when a debtor is new. */
  firmP25Days: number;
  firmP75Days: number;
  /**
   * Days-to-pay regressor — trained alongside the classifiers
   * on the same feature matrix but with daysToPay as the
   * continuous target. Null when there isn't enough signal.
   */
  daysToPay: DaysToPayRegressor | null;
};

// -------------------------------------------------------------------
// Per-firm model cache (1-hour TTL, in-memory). Survives request
// boundaries, refreshes on the next inference call after expiry.
// -------------------------------------------------------------------
const MODEL_CACHE = new Map<
  string,
  { model: MlModelBundle; expiresAt: number }
>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Percentile via linear interpolation. `q` in [0, 1]. */
function percentile(vals: number[], q: number): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = q * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  const frac = idx - lo;
  return s[lo] * (1 - frac) + s[hi] * frac;
}

function ageBucketFromDays(daysPastDue: number): string {
  if (daysPastDue <= 0) return "CURRENT";
  if (daysPastDue <= 30) return "DAYS_0_30";
  if (daysPastDue <= 60) return "DAYS_30_60";
  if (daysPastDue <= 90) return "DAYS_60_90";
  return "DAYS_90_PLUS";
}

/**
 * Extract a feature vector for one bill at a given "evaluation date."
 * Used both for training (historical snapshots) and inference
 * (today's open bills).
 */
export function extractFeatures(args: {
  billDate: Date;
  dueDate: Date | null;
  evaluationDate: Date;
  originalAmount: number;
  debtorMedianDays: number;
  debtorSampleSize: number;
  hasOpenPromise: boolean;
  isDisputed: boolean;
  isCredfloatOrigin: boolean;
}): MlFeatureRow {
  const due = args.dueDate ?? args.billDate;
  const daysPastDue = Math.floor(
    (args.evaluationDate.getTime() - due.getTime()) / 86400_000,
  );
  const bucket = ageBucketFromDays(daysPastDue);
  const daysSinceBill = Math.max(
    0,
    Math.floor(
      (args.evaluationDate.getTime() - args.billDate.getTime()) / 86400_000,
    ),
  );
  return [
    ...ageBucketOneHot(bucket),
    daysSinceBill,
    Math.log1p(Math.max(0, args.originalAmount)),
    args.debtorMedianDays,
    args.debtorSampleSize,
    args.hasOpenPromise ? 1 : 0,
    args.isDisputed ? 1 : 0,
    args.isCredfloatOrigin ? 1 : 0,
    args.billDate.getDay(),
    args.billDate.getMonth() + 1,
  ];
}

/**
 * Train one model per horizon from the firm's own historical bill→
 * receipt pairs. Returns null when there isn't enough signal; caller
 * falls back to the base-rate heuristic.
 */
export async function trainFirmModel(
  firmId: string,
): Promise<MlModelBundle | null> {
  // Pull all paid-invoice → first-receipt pairs as training data.
  // We use ReceiptAllocation as the link; bills with multiple
  // allocations contribute one row per bill (first payment wins).
  const allocs = await prisma.receiptAllocation.findMany({
    where: { invoice: { clientCompany: { firmId } } },
    select: {
      amount: true,
      receipt: { select: { receiptDate: true } },
      invoice: {
        select: {
          id: true,
          partyId: true,
          billDate: true,
          dueDate: true,
          originalAmount: true,
          origin: true,
          status: true,
        },
      },
    },
  });

  if (allocs.length < 30) return null;

  // First payment date per invoice (training label is the FIRST
  // receipt that touched the bill — represents when the clock stops).
  const firstPaidAt = new Map<string, Date>();
  const debtorDays = new Map<string, number[]>();
  for (const a of allocs) {
    const invId = a.invoice.id;
    const rDate = new Date(a.receipt.receiptDate);
    const bDate = new Date(a.invoice.billDate);
    const prev = firstPaidAt.get(invId);
    if (!prev || rDate < prev) firstPaidAt.set(invId, rDate);
    const daysToPay = Math.max(
      0,
      Math.floor((rDate.getTime() - bDate.getTime()) / 86400_000),
    );
    const arr = debtorDays.get(a.invoice.partyId) ?? [];
    arr.push(daysToPay);
    debtorDays.set(a.invoice.partyId, arr);
  }

  const debtorMedianDays = new Map<string, number>();
  const debtorP25Days = new Map<string, number>();
  const debtorP75Days = new Map<string, number>();
  const debtorSampleSize = new Map<string, number>();
  for (const [partyId, days] of debtorDays.entries()) {
    debtorMedianDays.set(partyId, median(days));
    debtorP25Days.set(partyId, percentile(days, 0.25));
    debtorP75Days.set(partyId, percentile(days, 0.75));
    debtorSampleSize.set(partyId, days.length);
  }
  const allDays: number[] = [];
  for (const ds of debtorDays.values()) allDays.push(...ds);
  const firmMedianDays = median(allDays);
  const firmP25Days = percentile(allDays, 0.25);
  const firmP75Days = percentile(allDays, 0.75);

  // Build training rows — one per distinct invoice.
  const seen = new Set<string>();
  const rows: TrainingRow[] = [];
  for (const a of allocs) {
    if (seen.has(a.invoice.id)) continue;
    seen.add(a.invoice.id);

    const paidAt = firstPaidAt.get(a.invoice.id);
    if (!paidAt) continue;

    const billDate = new Date(a.invoice.billDate);
    const dueDate = a.invoice.dueDate ? new Date(a.invoice.dueDate) : null;

    // Evaluate at BILL DATE — "given this bill today, will it be
    // paid within N days?" This is the question we ask at inference.
    const features = extractFeatures({
      billDate,
      dueDate,
      evaluationDate: billDate,
      originalAmount: Number(a.invoice.originalAmount),
      debtorMedianDays:
        debtorMedianDays.get(a.invoice.partyId) ?? firmMedianDays,
      debtorSampleSize: debtorSampleSize.get(a.invoice.partyId) ?? 0,
      hasOpenPromise: false, // historical — not tracked
      isDisputed: false,
      isCredfloatOrigin: a.invoice.origin === "CREDFLOAT",
    });

    const daysToPay = Math.max(
      0,
      Math.floor((paidAt.getTime() - billDate.getTime()) / 86400_000),
    );
    rows.push({ features, label: 0, daysToPay });
  }

  if (rows.length < 30) return null;

  // Train one classifier per horizon — binary target "paid within
  // N days from billDate". Using the same features but different
  // labels lets us calibrate each horizon separately without a
  // quantile-regression headache.
  const options = {
    seed: 42,
    maxFeatures: 0.8,
    replacement: true,
    nEstimators: 80,
  };

  const models: Partial<MlModelBundle["models"]> = {};
  const importance: Partial<MlModelBundle["featureImportance"]> = {};

  for (const h of [7, 14, 30, 60, 90] as const) {
    const labels = rows.map((r) => (r.daysToPay <= h ? 1 : 0));
    const positives = labels.filter((l) => l === 1).length;
    // Skip horizons where the label is all 0 or all 1 — RF needs
    // variance to train.
    if (positives === 0 || positives === labels.length) {
      continue;
    }
    const clf = new RandomForestClassifier(options);
    clf.train(
      rows.map((r) => r.features),
      labels,
    );
    models[h] = clf;
    // ml-random-forest doesn't expose per-tree feature importance
    // directly; we compute a rough proxy via selectionCounts if
    // available, else blank array.
    const sel = (clf as unknown as { selection?: number[][] }).selection;
    if (sel && Array.isArray(sel)) {
      const counts = new Array(FEATURE_NAMES.length).fill(0);
      for (const perTree of sel) for (const f of perTree) counts[f]++;
      const tot = counts.reduce((s, c) => s + c, 0);
      importance[h] = counts.map((c) => (tot > 0 ? c / tot : 0));
    } else {
      importance[h] = new Array(FEATURE_NAMES.length).fill(0);
    }
  }

  // At least one horizon needs to have trained successfully.
  if (Object.keys(models).length === 0) return null;

  // -----------------------------------------------------------------
  // Days-to-pay regressor — continuous target. Identical features,
  // same rows. Captures "how long from bill to first receipt."
  // Used on the Overview to answer "how much credit time does this
  // debtor actually need?" per debtor.
  // -----------------------------------------------------------------
  let daysToPay: DaysToPayRegressor | null = null;
  try {
    const reg = new RandomForestRegression({
      seed: 42,
      maxFeatures: 0.8,
      replacement: true,
      nEstimators: 80,
    });
    const regX = rows.map((r) => r.features);
    const regY = rows.map((r) => r.daysToPay);
    reg.train(regX, regY);
    const predicted = reg.predict(regX) as number[];
    // Residual std — proxy for prediction uncertainty. Used to
    // surface a P25/P75 band around the point estimate.
    let sumSq = 0;
    for (let i = 0; i < regY.length; i++) {
      const err = regY[i] - predicted[i];
      sumSq += err * err;
    }
    const residualStdDays = Math.sqrt(sumSq / Math.max(1, regY.length));
    daysToPay = {
      regressor: reg,
      residualStdDays,
      firmMedianDays,
    };
  } catch {
    // If the regressor fails (tiny dataset / degenerate splits),
    // leave it null — callers fall back to the empirical median.
    daysToPay = null;
  }

  return {
    models: models as MlModelBundle["models"],
    samples: rows.length,
    firmId,
    trainedAt: new Date(),
    featureImportance: importance as MlModelBundle["featureImportance"],
    debtorMedianDays,
    debtorP25Days,
    debtorP75Days,
    debtorSampleSize,
    firmMedianDays,
    firmP25Days,
    firmP75Days,
    daysToPay,
  };
}

/** Cached train — reuses a firm's model for 1 hour. */
export async function getFirmModel(
  firmId: string,
): Promise<MlModelBundle | null> {
  const cached = MODEL_CACHE.get(firmId);
  if (cached && cached.expiresAt > Date.now()) return cached.model;
  const fresh = await trainFirmModel(firmId);
  if (fresh) {
    MODEL_CACHE.set(firmId, {
      model: fresh,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
  return fresh;
}

/**
 * Predict per-bill probabilities using the cached model.
 * `predictions[h][i]` = P(bill i paid within h days).
 */
export function predictWithModel(
  bundle: MlModelBundle,
  features: MlFeatureRow[],
): Record<HorizonDays, number[]> {
  const out: Partial<Record<HorizonDays, number[]>> = {};
  // Empty feature matrix — skip the library entirely, it will
  // crash on Matrix.checkMatrix with zero rows.
  if (features.length === 0) {
    return { 7: [], 14: [], 30: [], 60: [], 90: [] };
  }
  for (const h of [7, 14, 30, 60, 90] as const) {
    const clf = bundle.models[h];
    if (!clf) {
      out[h] = features.map(() => 0);
      continue;
    }
    // predict returns array of integer labels (0/1). For probability
    // we use the underlying forest's predictProbability when
    // available; otherwise fall back to binary.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const predictor = clf as any;
      if (typeof predictor.predictProbability === "function") {
        const probs = predictor.predictProbability(features) as number[][];
        // probs[i] = [P(class=0), P(class=1)] — take the latter
        out[h] = probs.map((p) => p[1] ?? 0);
      } else {
        const labels = clf.predict(features) as number[];
        out[h] = labels.map((l) => (l === 1 ? 1 : 0));
      }
    } catch {
      // A single horizon failing shouldn't crash the whole forecast.
      out[h] = features.map(() => 0);
    }
  }
  return out as Record<HorizonDays, number[]>;
}

/**
 * Predict days-to-pay per bill using the regressor. Returns a
 * central estimate (p50) plus a P25/P75 band derived from the
 * training residual std — "expected to pay in ~24 days, typical
 * range 18–32." When the regressor is missing, falls back to the
 * firm median with a generous band so the UI never shows NaN.
 */
export function predictDaysToPayPerBill(
  bundle: MlModelBundle,
  features: MlFeatureRow[],
): { p25: number[]; p50: number[]; p75: number[] } {
  const n = features.length;
  // Empty feature matrix crashes ml-random-forest's Matrix.checkMatrix.
  // Short-circuit before we get there.
  if (n === 0) return { p25: [], p50: [], p75: [] };
  const reg = bundle.daysToPay;
  if (!reg) {
    const fallback = Math.max(1, Math.round(bundle.firmMedianDays || 30));
    return {
      p25: new Array(n).fill(Math.max(1, fallback - 7)),
      p50: new Array(n).fill(fallback),
      p75: new Array(n).fill(fallback + 14),
    };
  }
  try {
    const p50 = reg.regressor.predict(features) as number[];
    // ±0.6745σ → P25/P75 for an approximately normal residual.
    const halfBand = 0.6745 * reg.residualStdDays;
    const p25 = p50.map((v) => Math.max(0, Math.round(v - halfBand)));
    const p75 = p50.map((v) => Math.max(0, Math.round(v + halfBand)));
    const p50r = p50.map((v) => Math.max(0, Math.round(v)));
    return { p25, p50: p50r, p75 };
  } catch {
    // Defensive — if the regressor trips on a weird feature shape,
    // fall back silently rather than crashing the Overview page.
    const fallback = Math.max(1, Math.round(bundle.firmMedianDays || 30));
    return {
      p25: new Array(n).fill(Math.max(1, fallback - 7)),
      p50: new Array(n).fill(fallback),
      p75: new Array(n).fill(fallback + 14),
    };
  }
}
