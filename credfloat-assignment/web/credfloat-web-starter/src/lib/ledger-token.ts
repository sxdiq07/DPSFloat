import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, short-lived tokens used for public ledger-PDF download URLs.
 * The token encodes (partyId, period) + expiry and is HMAC'd with
 * LEDGER_TOKEN_SECRET (falls back to AUTH_SECRET). No DB round-trip
 * needed to validate — cheap and revocable by rotating the secret.
 *
 * Format: `<payload_b64url>.<sig_b64url>` where payload is
 *   JSON-stringified { partyId, period, exp } then base64url-encoded.
 */

export type LedgerPeriod =
  | { type: "FY_TO_DATE" }
  | { type: "LAST_12_MONTHS" }
  | { type: "OPEN_ITEMS_ONLY" }
  | { type: "ALL_HISTORY" }
  | { type: "CUSTOM"; start: string; end: string };

export type LedgerTokenPayload = {
  partyId: string;
  period: LedgerPeriod;
  exp: number; // unix seconds
};

function secret(): string {
  const s = process.env.LEDGER_TOKEN_SECRET ?? process.env.AUTH_SECRET;
  if (!s) {
    throw new Error(
      "LEDGER_TOKEN_SECRET or AUTH_SECRET must be set to sign ledger tokens.",
    );
  }
  return s;
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signLedgerToken(
  payload: Omit<LedgerTokenPayload, "exp">,
  ttlSeconds: number = 48 * 3600,
): string {
  const full: LedgerTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64urlEncode(JSON.stringify(full));
  const sig = createHmac("sha256", secret()).update(body).digest();
  return `${body}.${b64urlEncode(sig)}`;
}

export function verifyLedgerToken(token: string): LedgerTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expectedSig = createHmac("sha256", secret()).update(body).digest();
  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  let payload: LedgerTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.partyId || !payload.period) return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * Resolves the LedgerPeriodType + optional custom window into concrete
 * start / end dates. OPEN_ITEMS_ONLY returns null for start so callers
 * can branch on "no time bound, filter by status instead".
 */
export function resolvePeriod(period: LedgerPeriod): {
  start: Date | null;
  end: Date;
  label: string;
} {
  const now = new Date();
  if (period.type === "CUSTOM") {
    const start = new Date(period.start);
    const end = new Date(period.end);
    return {
      start,
      end,
      label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
    };
  }
  if (period.type === "ALL_HISTORY") {
    return { start: null, end: now, label: "All transactions" };
  }
  if (period.type === "OPEN_ITEMS_ONLY") {
    return { start: null, end: now, label: "Open items only" };
  }
  if (period.type === "LAST_12_MONTHS") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    return { start, end: now, label: "Last 12 months" };
  }
  // FY_TO_DATE: Indian FY starts 1 April.
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const start = new Date(y, 3, 1); // April = month index 3
  return { start, end: now, label: `FY ${y}-${(y + 1) % 100}` };
}
