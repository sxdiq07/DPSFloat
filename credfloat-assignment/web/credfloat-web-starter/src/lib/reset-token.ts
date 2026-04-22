import { createHmac, timingSafeEqual } from "crypto";

/**
 * Single-use password reset tokens. Signed HMAC over
 * `${userId}.${passwordHashPrefix}.${exp}` with AUTH_SECRET — so any
 * password change auto-invalidates previously issued tokens. No DB
 * round-trip to validate.
 *
 * Binding to the current password hash is what gives single-use
 * semantics: the moment the user completes a reset, the hash changes
 * and every outstanding link breaks.
 *
 * Format: `<userId>.<exp>.<sig>` all base64url.
 */

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set to sign reset tokens.");
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

export function signResetToken(params: {
  userId: string;
  currentHash: string;
  ttlSeconds?: number;
}): string {
  const ttl = params.ttlSeconds ?? 60 * 60; // 1h default
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const hashPrefix = params.currentHash.slice(0, 32);
  const body = `${b64urlEncode(params.userId)}.${exp}`;
  const sig = createHmac("sha256", secret())
    .update(`${body}.${hashPrefix}`)
    .digest();
  return `${body}.${b64urlEncode(sig)}`;
}

export function verifyResetToken(
  token: string,
  currentHash: string,
): { userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userIdB64, expStr, sigB64] = parts;

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;

  const hashPrefix = currentHash.slice(0, 32);
  const expectedSig = createHmac("sha256", secret())
    .update(`${userIdB64}.${expStr}.${hashPrefix}`)
    .digest();

  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  try {
    const userId = b64urlDecode(userIdB64).toString("utf8");
    if (!userId) return null;
    return { userId };
  } catch {
    return null;
  }
}

/**
 * Extracts the userId payload (unverified) so we can load the user's
 * current hash before verification. This does NOT validate the token.
 */
export function peekUserId(token: string): string | null {
  const [userIdB64] = token.split(".");
  if (!userIdB64) return null;
  try {
    const id = b64urlDecode(userIdB64).toString("utf8");
    return id || null;
  } catch {
    return null;
  }
}
