"use server";

import { z } from "zod";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { signResetToken } from "@/lib/reset-token";
import { logActivity } from "@/lib/activity";

const schema = z.object({ email: z.string().email() });

/**
 * Kick off a password reset — always returns success to avoid leaking
 * whether an email address is registered. If the account exists, a
 * short-lived signed link is emailed. The token is bound to the
 * current password hash, so it self-invalidates once the password is
 * changed.
 */
export async function requestPasswordReset(
  _prevState: { ok?: boolean; error?: string } | undefined,
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const email = parsed.data.email.trim().toLowerCase();

  const user = await prisma.firmStaff.findFirst({
    where: { email },
    select: { id: true, name: true, email: true, passwordHash: true, firmId: true },
  });

  // Intentionally always-ok regardless of whether the user exists
  if (!user) return { ok: true };

  const token = signResetToken({
    userId: user.id,
    currentHash: user.passwordHash,
    ttlSeconds: 60 * 60,
  });

  const base =
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const link = `${base.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;

  const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

  if (!resend) {
    console.warn(
      "[password-reset] RESEND_API_KEY not set — would have emailed:",
      link,
    );
  } else {
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
        to: email,
        subject: "Reset your Ledger password",
        text:
          `Hi ${user.name},\n\n` +
          `We received a request to reset your Ledger password. ` +
          `The link below is valid for 1 hour and can only be used once:\n\n` +
          `${link}\n\n` +
          `If you didn't request this, you can safely ignore this email. ` +
          `Your password will stay the same.\n\n` +
          `— Ledger (DPS & Co)`,
        html:
          `<p>Hi ${escapeHtml(user.name)},</p>` +
          `<p>We received a request to reset your Ledger password. ` +
          `The link below is valid for 1 hour and can only be used once:</p>` +
          `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#0071e3;color:#fff;border-radius:8px;text-decoration:none">Reset password</a></p>` +
          `<p style="font-size:12px;color:#666">If the button doesn't work, paste this link into your browser:<br>${escapeHtml(link)}</p>` +
          `<p>If you didn't request this, you can safely ignore this email.</p>` +
          `<p style="color:#888;font-size:12px">— Ledger (DPS &amp; Co)</p>`,
      });
    } catch (err) {
      console.error("[password-reset] email send failed:", err);
      // Still return ok — we don't want to leak mail-deliverability state
    }
  }

  await logActivity({
    firmId: user.firmId,
    actorId: user.id,
    action: "auth.password_reset_requested",
    targetType: "FirmStaff",
    targetId: user.id,
    meta: {},
  });

  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
