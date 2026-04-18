import { AgeBucket } from "@prisma/client";

/**
 * Compute the ageing bucket for an invoice given its due date.
 * Pure function — easy to unit test.
 *
 * Uses calendar days between today and dueDate. Positive days = overdue.
 */
export function computeAgeBucket(dueDate: Date, today: Date = new Date()): AgeBucket {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysOverdue = Math.floor(
    (today.getTime() - dueDate.getTime()) / msPerDay,
  );

  if (daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "DAYS_0_30";
  if (daysOverdue <= 60) return "DAYS_30_60";
  if (daysOverdue <= 90) return "DAYS_60_90";
  return "DAYS_90_PLUS";
}

/**
 * Days since due date. Negative = not yet due.
 */
export function daysOverdue(dueDate: Date, today: Date = new Date()): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((today.getTime() - dueDate.getTime()) / msPerDay);
}

export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  CURRENT: "Current",
  DAYS_0_30: "0–30 days",
  DAYS_30_60: "30–60 days",
  DAYS_60_90: "60–90 days",
  DAYS_90_PLUS: "90+ days",
};

export const AGE_BUCKET_COLORS: Record<AgeBucket, string> = {
  CURRENT: "bg-emerald-100 text-emerald-900 border-emerald-200",
  DAYS_0_30: "bg-sky-100 text-sky-900 border-sky-200",
  DAYS_30_60: "bg-amber-100 text-amber-900 border-amber-200",
  DAYS_60_90: "bg-orange-100 text-orange-900 border-orange-200",
  DAYS_90_PLUS: "bg-red-100 text-red-900 border-red-200",
};

export const AGE_BUCKETS_ORDER: AgeBucket[] = [
  "CURRENT",
  "DAYS_0_30",
  "DAYS_30_60",
  "DAYS_60_90",
  "DAYS_90_PLUS",
];
