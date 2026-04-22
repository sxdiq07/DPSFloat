"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { peekUserId, verifyResetToken } from "@/lib/reset-token";
import { logActivity } from "@/lib/activity";

const schema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Use at least 8 characters."),
    confirm: z.string().min(8),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match.",
    path: ["confirm"],
  });

/**
 * Validate reset token and set a new password hash. Binding to the
 * existing hash means a successful reset automatically invalidates
 * the link (and any duplicate copies) — no revocation table needed.
 */
export async function resetPassword(
  _prevState: { ok?: boolean; error?: string } | undefined,
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const userId = peekUserId(parsed.data.token);
  if (!userId) return { error: "This link is invalid." };

  const user = await prisma.firmStaff.findUnique({
    where: { id: userId },
    select: { id: true, firmId: true, passwordHash: true },
  });
  if (!user) return { error: "This link is invalid." };

  const check = verifyResetToken(parsed.data.token, user.passwordHash);
  if (!check) {
    return {
      error:
        "This reset link has expired or already been used. Request a new one.",
    };
  }

  const newHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.firmStaff.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  await logActivity({
    firmId: user.firmId,
    actorId: user.id,
    action: "auth.password_reset_completed",
    targetType: "FirmStaff",
    targetId: user.id,
    meta: {},
  });

  return { ok: true };
}
