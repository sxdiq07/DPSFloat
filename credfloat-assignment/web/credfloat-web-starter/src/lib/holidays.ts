/**
 * Major Indian holidays where dispatching payment reminders would read as tone-deaf.
 * Dates in YYYY-MM-DD (IST). Conservative list — focuses on nationally observed days.
 * Refresh annually; safe to extend per region.
 */
const HOLIDAYS_IST = new Set<string>([
  // 2026
  "2026-01-14", // Makar Sankranti / Pongal
  "2026-01-26", // Republic Day
  "2026-02-17", // Maha Shivaratri
  "2026-03-03", // Holi
  "2026-03-21", // Eid-ul-Fitr (approx)
  "2026-04-14", // Ambedkar Jayanti
  "2026-05-01", // Labour Day
  "2026-05-27", // Eid-ul-Adha (approx)
  "2026-08-15", // Independence Day
  "2026-08-27", // Janmashtami
  "2026-09-05", // Ganesh Chaturthi
  "2026-10-02", // Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-08", // Diwali
  "2026-11-09", // Govardhan Puja
  "2026-12-25", // Christmas

  // 2027 (skeleton — update as calendars are confirmed)
  "2027-01-14",
  "2027-01-26",
  "2027-03-22",
  "2027-08-15",
  "2027-10-02",
  "2027-10-29", // Diwali approx
  "2027-12-25",
]);

function istDateString(d: Date = new Date()): string {
  // Return YYYY-MM-DD in IST
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isIndianHoliday(d: Date = new Date()): boolean {
  return HOLIDAYS_IST.has(istDateString(d));
}

export function todayISTString(): string {
  return istDateString(new Date());
}
