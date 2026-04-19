/**
 * Reliability score for a debtor: transparent, free, deterministic.
 *
 * Inputs:
 *   - promises kept vs broken
 *   - promises still open (neutral)
 *   - overdue days (penalty)
 *
 * Scale 0-100. Higher = more reliable.
 * Defaults to null when there's no evidence yet — we don't invent a number.
 */
export function computeReliability({
  kept,
  broken,
  openPastDue,
  daysOverdueMax,
}: {
  kept: number;
  broken: number;
  openPastDue: number;
  daysOverdueMax: number;
}): number | null {
  const signals = kept + broken + openPastDue;
  if (signals === 0 && daysOverdueMax === 0) return null;

  // Keep-rate: counts kept promises against all concluded ones
  const concluded = kept + broken;
  const keepRate = concluded === 0 ? 0.6 : kept / concluded;

  // Past-due promises are penalized as if half-broken
  const effectivePromises = signals || 1;
  const effectiveKept = kept + openPastDue * 0.5;
  const rate = Math.min(1, Math.max(0, effectiveKept / effectivePromises));

  // Mix keep-rate with rate
  let score = Math.round((keepRate * 0.6 + rate * 0.4) * 100);

  // Ageing penalty: cap max debt staleness
  if (daysOverdueMax > 0) {
    const penalty = Math.min(40, Math.floor(daysOverdueMax / 10));
    score = Math.max(0, score - penalty);
  }

  return Math.max(0, Math.min(100, score));
}

export function reliabilityTone(
  score: number | null,
): "success" | "accent" | "warning" | "danger" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 75) return "success";
  if (score >= 55) return "accent";
  if (score >= 35) return "warning";
  return "danger";
}
