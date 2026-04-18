import { Prisma } from "@prisma/client";

function toNumber(amount: number | bigint | Prisma.Decimal | string): number {
  if (typeof amount === "number") return amount;
  if (typeof amount === "bigint") return Number(amount);
  if (typeof amount === "string") return parseFloat(amount);
  return amount.toNumber();
}

/**
 * Format a number as Indian Rupees, full format.
 * e.g. 123456 -> ₹1,23,456
 */
export function formatINR(amount: number | bigint | Prisma.Decimal | string): string {
  const n = toNumber(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Compact Indian currency format using lakh/crore.
 * e.g. 1_50_000 -> ₹1.50L
 * e.g. 3_45_00_000 -> ₹3.45Cr
 * Used for KPI tiles where space is tight.
 */
export function formatINRCompact(amount: number | bigint | Prisma.Decimal | string): string {
  const n = toNumber(amount);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}
