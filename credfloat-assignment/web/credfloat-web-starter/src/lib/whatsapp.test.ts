import { describe, it, expect } from "vitest";
import {
  buildWhatsAppClickUrl,
  normalizePhone,
  renderWhatsAppText,
} from "./whatsapp";

describe("normalizePhone", () => {
  it("strips spaces, dashes, plus, and parens", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("919876543210");
    expect(normalizePhone("(+91) 98765 43210")).toBe("919876543210");
  });
});

describe("renderWhatsAppText", () => {
  const base = {
    partyName: "ACME Traders",
    clientCompanyName: "DPS Demo Pvt Ltd",
    billRef: "INV-2026-001",
    billDate: new Date("2026-03-01T00:00:00Z"),
    dueDate: new Date("2026-03-15T00:00:00Z"),
    amount: 125000,
  };

  it("uses the gentle tone when not yet due", () => {
    const text = renderWhatsAppText({ ...base, daysOverdue: -3 });
    expect(text).toContain("Friendly reminder");
    expect(text).toContain("INV-2026-001");
    expect(text).toContain("ACME Traders");
  });

  it("uses the follow-up tone when overdue within 30 days", () => {
    const text = renderWhatsAppText({ ...base, daysOverdue: 14 });
    expect(text).toContain("Payment follow-up");
    expect(text).toContain("14 days overdue");
  });

  it("uses the final tone past 30 days overdue", () => {
    const text = renderWhatsAppText({ ...base, daysOverdue: 45 });
    expect(text).toContain("Final reminder");
    expect(text).toContain("45 days overdue");
  });
});

describe("buildWhatsAppClickUrl", () => {
  const base = {
    to: "+91 98765-43210",
    partyName: "ACME Traders",
    clientCompanyName: "DPS Demo Pvt Ltd",
    billRef: "INV-2026-001",
    billDate: new Date("2026-03-01T00:00:00Z"),
    dueDate: new Date("2026-03-15T00:00:00Z"),
    amount: 125000,
    daysOverdue: 14,
  };

  it("produces a wa.me URL with the normalized number", () => {
    const url = buildWhatsAppClickUrl(base);
    expect(url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  });

  it("URL-encodes the message body", () => {
    const url = buildWhatsAppClickUrl(base);
    expect(url).toContain("ACME%20Traders");
    expect(url).toContain("INV-2026-001");
  });

  it("returns null for a too-short phone number", () => {
    expect(buildWhatsAppClickUrl({ ...base, to: "123" })).toBeNull();
  });
});
