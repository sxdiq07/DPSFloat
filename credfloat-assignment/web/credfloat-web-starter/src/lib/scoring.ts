/**
 * A-F credit grading for debtors + clients, calibrated to the
 * observable signals we already have in the DB. Deterministic,
 * explainable, auditable — every grade comes with a factor
 * breakdown you can surface in a tooltip.
 *
 * Thresholds:
 *   A  ≥ 85   — clean book, pays on time, no disputes
 *   B  70-84  — generally healthy, minor slippage
 *   C  55-69  — some concerns, worth a call
 *   D  40-54  — risky, escalate
 *   F  < 40   — write-off territory / fully opted out / archived
 */

export type Grade = "A" | "B" | "C" | "D" | "F";

export function gradeFromScore(score: number): Grade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function gradeTone(grade: Grade | null): {
  label: string;
  color: string;
  bg: string;
  border: string;
} {
  switch (grade) {
    case "A":
      return {
        label: "A",
        color: "#1f7a4a",
        bg: "rgba(48,209,88,0.10)",
        border: "rgba(48,209,88,0.30)",
      };
    case "B":
      return {
        label: "B",
        color: "#0057b7",
        bg: "rgba(0,113,227,0.08)",
        border: "rgba(0,113,227,0.25)",
      };
    case "C":
      return {
        label: "C",
        color: "#92400e",
        bg: "rgba(245,158,11,0.10)",
        border: "rgba(245,158,11,0.30)",
      };
    case "D":
      return {
        label: "D",
        color: "#c6373a",
        bg: "rgba(255,69,58,0.08)",
        border: "rgba(255,69,58,0.25)",
      };
    case "F":
      return {
        label: "F",
        color: "#991b1b",
        bg: "rgba(185,28,28,0.10)",
        border: "rgba(185,28,28,0.30)",
      };
    default:
      return {
        label: "—",
        color: "#86868b",
        bg: "rgba(134,134,139,0.08)",
        border: "rgba(134,134,139,0.20)",
      };
  }
}

// -------------------------------------------------------------------
// Debtor-level scoring
// -------------------------------------------------------------------

export type DebtorScoreInput = {
  kept: number;
  broken: number;
  openPastDue: number;
  daysOverdueMax: number;
  ageing: {
    current: number;
    days_0_30: number;
    days_30_60: number;
    days_60_90: number;
    days_90_plus: number;
  };
  reminderStats?: {
    sent: number;
    delivered: number;
    opened: number;
    bounced: number;
  };
  hasOpenDispute: boolean;
  optedOut: boolean;
  archived: boolean;
};

export type DebtorFactors = {
  keepRate: number; // 0-1
  agingConcentration: number; // 0-1 (higher = more of debt in 60+/90+)
  responseRate: number | null; // 0-1 (null if insufficient data)
  hasOpenDispute: boolean;
  optedOut: boolean;
};

export type DebtorScore = {
  grade: Grade | null;
  numeric: number | null;
  factors: DebtorFactors;
};

export function scoreDebtor(input: DebtorScoreInput): DebtorScore {
  // Hard-off cases: debtor is archived or opted out — implicit F.
  if (input.archived || input.optedOut) {
    return {
      grade: "F",
      numeric: 0,
      factors: {
        keepRate: 0,
        agingConcentration: 1,
        responseRate: null,
        hasOpenDispute: input.hasOpenDispute,
        optedOut: input.optedOut,
      },
    };
  }

  const signals = input.kept + input.broken + input.openPastDue;
  const hasAnyActivity =
    signals > 0 ||
    input.daysOverdueMax > 0 ||
    (input.reminderStats && input.reminderStats.sent > 0);
  if (!hasAnyActivity) {
    // No evidence — don't invent a number.
    return {
      grade: null,
      numeric: null,
      factors: {
        keepRate: 0,
        agingConcentration: 0,
        responseRate: null,
        hasOpenDispute: input.hasOpenDispute,
        optedOut: false,
      },
    };
  }

  // Component 1: keep-rate (concluded promises only).
  const concluded = input.kept + input.broken;
  const keepRate = concluded === 0 ? 0.6 : input.kept / concluded;

  // Component 2: ageing concentration — % of total outstanding that
  // sits in 60+ days overdue.
  const ageTotal =
    input.ageing.current +
    input.ageing.days_0_30 +
    input.ageing.days_30_60 +
    input.ageing.days_60_90 +
    input.ageing.days_90_plus;
  const badAge =
    ageTotal === 0
      ? 0
      : (input.ageing.days_60_90 + input.ageing.days_90_plus) / ageTotal;

  // Component 3: reminder response rate (if enough sends).
  let responseRate: number | null = null;
  if (input.reminderStats && input.reminderStats.sent >= 3) {
    const positive =
      input.reminderStats.opened + input.reminderStats.delivered * 0.3;
    responseRate = Math.min(1, positive / input.reminderStats.sent);
  }

  // Weighted mix (out of 100).
  // Keep-rate 40, ageing 30, response 20, days-overdue penalty up to 10.
  const keepPts = keepRate * 40;
  const agingPts = (1 - badAge) * 30;
  const responsePts = responseRate === null ? 15 : responseRate * 20;
  const maxResponsePts = responseRate === null ? 15 : 20;

  const raw = keepPts + agingPts + responsePts;
  const maxRaw = 40 + 30 + maxResponsePts;
  let score = Math.round((raw / maxRaw) * 100);

  // Days-overdue scalar penalty: max -20 for >= 180 days.
  if (input.daysOverdueMax > 0) {
    const pen = Math.min(20, Math.floor(input.daysOverdueMax / 9));
    score -= pen;
  }

  // Dispute: knock one grade (about 15 points).
  if (input.hasOpenDispute) {
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  return {
    grade: gradeFromScore(score),
    numeric: score,
    factors: {
      keepRate,
      agingConcentration: badAge,
      responseRate,
      hasOpenDispute: input.hasOpenDispute,
      optedOut: false,
    },
  };
}

// -------------------------------------------------------------------
// Client-level (SME portfolio) scoring
// -------------------------------------------------------------------

export type ClientScoreInput = {
  /**
   * Per-debtor scores — optional. When present, contributes a
   * weighted-average debtor reliability to the grade. When absent
   * (typical for the clients-list page where per-debtor scoring is
   * too expensive), we redistribute the weight across the other
   * factors so the grade is still meaningful.
   */
  debtors?: Array<{
    score: number | null;
    outstandingAmount: number;
  }>;
  totalOutstanding: number;
  overdue60PlusAmount: number;
  promises: { kept: number; broken: number };
  /** Largest single debtor's outstanding — used for concentration risk. */
  topDebtorOutstanding: number;
};

export type ClientFactors = {
  weightedDebtorReliability: number; // 0-100
  promiseKeepRate: number; // 0-1
  overdueConcentration: number; // 0-1 (60+ overdue / total)
  topDebtorShare: number; // 0-1 (largest debtor / total)
};

export type ClientScore = {
  grade: Grade | null;
  numeric: number | null;
  factors: ClientFactors;
};

export function scoreClient(input: ClientScoreInput): ClientScore {
  if (input.totalOutstanding === 0 && !input.debtors?.length) {
    return {
      grade: null,
      numeric: null,
      factors: {
        weightedDebtorReliability: 0,
        promiseKeepRate: 0,
        overdueConcentration: 0,
        topDebtorShare: 0,
      },
    };
  }

  // Component 1: weighted average debtor reliability, weighted by
  // outstanding amount (large debtors matter more). Optional —
  // when absent we redistribute its weight to the other factors.
  const withScore = (input.debtors ?? []).filter((d) => d.score !== null);
  let weightedDebtorReliability = 0;
  const hasDebtorData = withScore.length > 0;
  if (hasDebtorData) {
    let weightedSum = 0;
    let weight = 0;
    for (const d of withScore) {
      if (d.score === null) continue;
      weightedSum += d.score * Math.max(0, d.outstandingAmount);
      weight += Math.max(0, d.outstandingAmount);
    }
    weightedDebtorReliability =
      weight > 0
        ? weightedSum / weight
        : withScore.reduce((s, d) => s + (d.score ?? 0), 0) /
          Math.max(1, withScore.length);
  }

  // Component 2: firm-wide promise keep-rate.
  const totalPromises = input.promises.kept + input.promises.broken;
  const promiseKeepRate =
    totalPromises === 0 ? 0.6 : input.promises.kept / totalPromises;

  // Component 3: overdue concentration.
  const overdueConcentration =
    input.totalOutstanding > 0
      ? Math.min(1, input.overdue60PlusAmount / input.totalOutstanding)
      : 0;

  // Component 4: top-debtor concentration risk.
  const topDebtorShare =
    input.totalOutstanding > 0
      ? Math.min(1, input.topDebtorOutstanding / input.totalOutstanding)
      : 0;

  // Weighted mix. When we have per-debtor scores:
  //   50%  debtor reliability
  //   25%  promise keep-rate
  //   15%  (1 - overdue concentration)
  //   10%  concentration risk (penalty if top debtor > 40% of book)
  //
  // When we DON'T have per-debtor scores (list page), redistribute
  // the 50% that was on reliability:
  //   45%  promise keep-rate    (+20)
  //   40%  (1 - overdue)        (+25)
  //   15%  concentration risk   (+5)
  let score: number;
  if (hasDebtorData) {
    const reliabilityPts = (weightedDebtorReliability / 100) * 50;
    const promisePts = promiseKeepRate * 25;
    const overduePts = (1 - overdueConcentration) * 15;
    const concentrationPts = topDebtorShare > 0.4 ? 0 : 10;
    score = Math.round(
      reliabilityPts + promisePts + overduePts + concentrationPts,
    );
  } else {
    const promisePts = promiseKeepRate * 45;
    const overduePts = (1 - overdueConcentration) * 40;
    const concentrationPts = topDebtorShare > 0.4 ? 0 : 15;
    score = Math.round(promisePts + overduePts + concentrationPts);
  }

  return {
    grade: gradeFromScore(score),
    numeric: score,
    factors: {
      weightedDebtorReliability,
      promiseKeepRate,
      overdueConcentration,
      topDebtorShare,
    },
  };
}
