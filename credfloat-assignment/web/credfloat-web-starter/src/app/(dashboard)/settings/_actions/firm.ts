"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";

const schema = z.object({
  frn: z.string().max(40).nullable(),
  partnerName: z.string().max(120).nullable(),
  partnerMno: z.string().max(40).nullable(),
  bankName: z.string().max(120).nullable(),
  bankAccountName: z.string().max(120).nullable(),
  bankAccountNumber: z.string().max(40).nullable(),
  bankIfsc: z.string().max(20).nullable(),
  upiId: z.string().max(80).nullable(),
});

export type FirmUpdateResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Updates the firm's letterhead metadata — FRN, partner name, ICAI
 * membership number. These fields render on the signatory block of
 * every ledger-statement PDF emitted by the reminder flow.
 *
 * PARTNER role only — staff can't change the firm's letterhead.
 */
export async function updateFirmLetterhead(
  input: z.infer<typeof schema>,
): Promise<FirmUpdateResult> {
  const session = await requireAuth();
  if (session.user.role !== "PARTNER") {
    return { ok: false, error: "Only partners can edit the firm letterhead." };
  }
  const firmId = await requireFirmId();

  const parsed = schema.safeParse({
    frn: input.frn?.trim() || null,
    partnerName: input.partnerName?.trim() || null,
    partnerMno: input.partnerMno?.trim() || null,
    bankName: input.bankName?.trim() || null,
    bankAccountName: input.bankAccountName?.trim() || null,
    bankAccountNumber: input.bankAccountNumber?.trim() || null,
    bankIfsc: input.bankIfsc?.trim() || null,
    upiId: input.upiId?.trim() || null,
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  await prisma.firm.update({
    where: { id: firmId },
    data: parsed.data,
  });
  await logActivity({
    firmId,
    actorId: session.user.id,
    action: "firm.letterhead_updated",
    targetType: "Firm",
    targetId: firmId,
    meta: { ...parsed.data },
  });
  revalidatePath("/settings");
  return { ok: true };
}
