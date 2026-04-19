import { describe, it, expect } from "vitest";
import { computeAgeBucket, daysOverdue, getISTToday } from "./ageing";

// Fixed reference point so tests are deterministic regardless of when they run.
const TODAY = new Date("2026-05-01T00:00:00.000Z");

function daysBefore(n: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

describe("computeAgeBucket", () => {
  it("returns CURRENT when not yet due", () => {
    expect(computeAgeBucket(daysBefore(-5), TODAY)).toBe("CURRENT");
  });

  it("returns CURRENT on the due date itself", () => {
    expect(computeAgeBucket(TODAY, TODAY)).toBe("CURRENT");
  });

  it("returns DAYS_0_30 at 1 day overdue", () => {
    expect(computeAgeBucket(daysBefore(1), TODAY)).toBe("DAYS_0_30");
  });

  it("returns DAYS_0_30 exactly at 30 days overdue", () => {
    expect(computeAgeBucket(daysBefore(30), TODAY)).toBe("DAYS_0_30");
  });

  it("returns DAYS_30_60 at 31 days overdue", () => {
    expect(computeAgeBucket(daysBefore(31), TODAY)).toBe("DAYS_30_60");
  });

  it("returns DAYS_30_60 at 60 days overdue", () => {
    expect(computeAgeBucket(daysBefore(60), TODAY)).toBe("DAYS_30_60");
  });

  it("returns DAYS_60_90 at 61 days overdue", () => {
    expect(computeAgeBucket(daysBefore(61), TODAY)).toBe("DAYS_60_90");
  });

  it("returns DAYS_60_90 at 90 days overdue", () => {
    expect(computeAgeBucket(daysBefore(90), TODAY)).toBe("DAYS_60_90");
  });

  it("returns DAYS_90_PLUS at 91 days overdue", () => {
    expect(computeAgeBucket(daysBefore(91), TODAY)).toBe("DAYS_90_PLUS");
  });

  it("returns DAYS_90_PLUS at 1000 days overdue", () => {
    expect(computeAgeBucket(daysBefore(1000), TODAY)).toBe("DAYS_90_PLUS");
  });
});

describe("daysOverdue", () => {
  it("is 0 on the due date", () => {
    expect(daysOverdue(TODAY, TODAY)).toBe(0);
  });

  it("is positive when past due", () => {
    expect(daysOverdue(daysBefore(14), TODAY)).toBe(14);
  });

  it("is negative when not yet due", () => {
    expect(daysOverdue(daysBefore(-7), TODAY)).toBe(-7);
  });
});

describe("getISTToday", () => {
  it("returns a Date at midnight in IST (00:00 Asia/Kolkata)", () => {
    const today = getISTToday();
    // toZonedTime yields a Date whose local wall-clock matches IST midnight.
    // In node (UTC env), that means the Date's UTC hours should read 00.
    // Running on other locales may shift, so we assert hours/minutes are zero.
    expect(today.getHours()).toBe(0);
    expect(today.getMinutes()).toBe(0);
    expect(today.getSeconds()).toBe(0);
    expect(today.getMilliseconds()).toBe(0);
  });
});
