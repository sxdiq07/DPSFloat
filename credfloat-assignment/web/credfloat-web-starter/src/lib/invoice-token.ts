import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, short-lived tokens for public one-invoice share URLs.
 * Same HMAC pattern as ledger-token.ts but scoped to a single
 * invoiceId. Lets a partner send a debtor a link to ONE bill with
 * UPI / bank details, without exposing the rest of the ledger.
 */

export type InvoiceTokenPayload = {
  invoiceId: string;
  exp: number; // unix seconds
};

function secret(): string {
  const s = process.env.LEDGER_TOKEN_SECRET ?? process.env.AUTH_SECRET;
  if (!s) {
    throw new Error(
      "LEDGER_TOKEN_SECRET or AUTH_SECRET must be set to sign invoice tokens.",
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

export function signInvoiceToken(
  invoiceId: string,
  ttlSeconds: number = 48 * 3600,
): string {
  const full: InvoiceTokenPayload = {
    invoiceId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = b64urlEncode(JSON.stringify(full));
  const sig = createHmac("sha256", secret()).update(body).digest();
  return `${body}.${b64urlEncode(sig)}`;
}

export function verifyInvoiceToken(
  token: string,
): InvoiceTokenPayload | null {
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

  let payload: InvoiceTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.invoiceId) return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
