import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resend webhook → ReminderSent.status updates.
 *
 * Resend dispatches webhooks signed via Svix. Verification follows the
 * Svix scheme: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}`
 * with the base64-decoded secret (stripping the `whsec_` prefix).
 *
 * Event → SendStatus mapping:
 *   email.delivered         → DELIVERED
 *   email.bounced           → BOUNCED
 *   email.complained        → BOUNCED  (complaint == deliverability failure)
 *   email.delivery_delayed  → (no change)
 *   email.opened            → READ
 *   email.clicked           → READ
 */

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string | string[];
    bounce?: { message?: string };
  };
};

const STATUS_BY_EVENT: Record<
  string,
  "DELIVERED" | "BOUNCED" | "READ" | null
> = {
  "email.delivered": "DELIVERED",
  "email.bounced": "BOUNCED",
  "email.complained": "BOUNCED",
  "email.opened": "READ",
  "email.clicked": "READ",
  "email.sent": null,
  "email.delivery_delayed": null,
};

function verify(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // Allow unverified delivery in dev when no secret is set. This is
  // intentional — without a secret we have no way to check auth, but
  // the endpoint is still useful for local testing via `curl`.
  if (!secret) return true;

  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;

  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBuf: Buffer;
  try {
    keyBuf = Buffer.from(key, "base64");
  } catch {
    return false;
  }

  const toSign = `${id}.${ts}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", keyBuf)
    .update(toSign)
    .digest("base64");

  // `svix-signature` is space-separated: `v1,<b64>` entries
  const parts = sigHeader.split(" ");
  for (const p of parts) {
    const [, sig] = p.split(",");
    if (!sig) continue;
    try {
      if (
        crypto.timingSafeEqual(
          Buffer.from(sig, "base64"),
          Buffer.from(expected, "base64"),
        )
      ) {
        return true;
      }
    } catch {
      // length mismatch — keep trying
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verify(req, raw)) {
    return NextResponse.json(
      { ok: false, error: "invalid signature" },
      { status: 401 },
    );
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  const nextStatus = STATUS_BY_EVENT[event.type];
  if (nextStatus === undefined) {
    // Unknown event — acknowledge so Resend doesn't retry
    return NextResponse.json({ ok: true, skipped: "unknown_event" });
  }
  if (nextStatus === null) {
    return NextResponse.json({ ok: true, skipped: "no_status_change" });
  }

  const providerId = event.data?.email_id;
  if (!providerId) {
    return NextResponse.json({ ok: true, skipped: "no_email_id" });
  }

  const row = await prisma.reminderSent.findFirst({
    where: { providerId, channel: "EMAIL" },
    select: { id: true, status: true },
  });
  if (!row) {
    return NextResponse.json({ ok: true, skipped: "unknown_provider_id" });
  }

  // Monotonic progression — never downgrade DELIVERED→SENT or READ→DELIVERED
  const rank: Record<string, number> = {
    SENT: 1,
    DELIVERED: 2,
    READ: 3,
    FAILED: 4,
    BOUNCED: 4,
  };
  if ((rank[nextStatus] ?? 0) < (rank[row.status] ?? 0)) {
    return NextResponse.json({ ok: true, skipped: "already_at_higher_state" });
  }

  await prisma.reminderSent.update({
    where: { id: row.id },
    data: {
      status: nextStatus,
      error:
        nextStatus === "BOUNCED"
          ? event.data?.bounce?.message ?? "bounced"
          : null,
    },
  });

  return NextResponse.json({
    ok: true,
    reminderId: row.id,
    status: nextStatus,
  });
}
