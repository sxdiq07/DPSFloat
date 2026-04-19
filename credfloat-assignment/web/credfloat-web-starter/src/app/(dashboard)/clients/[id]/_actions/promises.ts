"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";

const addSchema = z.object({
  partyId: z.string(),
  amount: z.number().positive(),
  promisedBy: z.string(),
  notes: z.string().max(500).optional().nullable(),
});

export async function addPromise(
  input: z.infer<typeof addSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    const session = await requireAuth();
    const firmId = await requireFirmId();
    const party = await prisma.party.findFirst({
      where: { id: parsed.data.partyId, clientCompany: { firmId } },
      select: { id: true, clientCompanyId: true },
    });
    if (!party) return { ok: false, error: "Debtor not found" };
    const created = await prisma.promiseToPay.create({
      data: {
        partyId: party.id,
        amount: parsed.data.amount,
        promisedBy: new Date(parsed.data.promisedBy),
        recordedBy: session.user.id,
        notes: parsed.data.notes ?? null,
      },
    });
    await logActivity({
      firmId,
      actorId: session.user.id,
      action: "promise.recorded",
      targetType: "PromiseToPay",
      targetId: created.id,
      meta: {
        partyId: party.id,
        amount: parsed.data.amount,
        promisedBy: parsed.data.promisedBy,
      },
    });
    revalidatePath(`/clients/${party.clientCompanyId}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function resolvePromise(
  promiseId: string,
  status: "KEPT" | "BROKEN",
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireAuth();
    const firmId = await requireFirmId();
    const p = await prisma.promiseToPay.findFirst({
      where: { id: promiseId, party: { clientCompany: { firmId } } },
      select: { id: true, party: { select: { clientCompanyId: true } } },
    });
    if (!p) return { ok: false, error: "Not found" };
    await prisma.promiseToPay.update({
      where: { id: p.id },
      data: { status },
    });
    await logActivity({
      firmId,
      actorId: session.user.id,
      action: `promise.${status.toLowerCase()}`,
      targetType: "PromiseToPay",
      targetId: p.id,
      meta: { clientCompanyId: p.party.clientCompanyId },
    });
    revalidatePath(`/clients/${p.party.clientCompanyId}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
