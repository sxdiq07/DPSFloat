"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";

const disputeSchema = z.object({
  invoiceId: z.string(),
  disputed: z.boolean(),
  reason: z.string().max(500).optional().nullable(),
});

/**
 * Toggle an invoice's DISPUTED status. Reminders cron already filters
 * `status: OPEN` so a DISPUTED bill is automatically excluded from
 * future auto-reminders. Staff can un-dispute later to resume chasing.
 */
export async function setInvoiceDispute(
  input: z.infer<typeof disputeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = disputeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    const session = await requireAuth();
    const firmId = await requireFirmId();
    const invoice = await prisma.invoice.findFirst({
      where: { id: parsed.data.invoiceId, clientCompany: { firmId } },
      select: { id: true, status: true, clientCompanyId: true, billRef: true },
    });
    if (!invoice) return { ok: false, error: "Invoice not found" };

    const next = parsed.data.disputed ? "DISPUTED" : "OPEN";
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: next },
    });
    await logActivity({
      firmId,
      actorId: session.user.id,
      action: parsed.data.disputed ? "invoice.disputed" : "invoice.undisputed",
      targetType: "Invoice",
      targetId: invoice.id,
      meta: {
        billRef: invoice.billRef,
        reason: parsed.data.reason ?? null,
      },
    });
    revalidatePath(`/clients/${invoice.clientCompanyId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const paidSchema = z.object({ invoiceId: z.string() });

/**
 * Manually mark an invoice as fully paid — for the gap between a
 * payment arriving and the next Tally sync. Sets outstandingAmount
 * to zero and flips status to PAID. Next Tally sync may override if
 * Tally shows a different outstanding; that's intentional — Tally
 * remains source of truth.
 */
export async function markInvoicePaid(
  input: z.infer<typeof paidSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = paidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try {
    const session = await requireAuth();
    const firmId = await requireFirmId();
    const invoice = await prisma.invoice.findFirst({
      where: { id: parsed.data.invoiceId, clientCompany: { firmId } },
      select: {
        id: true,
        clientCompanyId: true,
        billRef: true,
        outstandingAmount: true,
      },
    });
    if (!invoice) return { ok: false, error: "Invoice not found" };

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        outstandingAmount: new Prisma.Decimal(0),
      },
    });
    await logActivity({
      firmId,
      actorId: session.user.id,
      action: "invoice.marked_paid_manual",
      targetType: "Invoice",
      targetId: invoice.id,
      meta: {
        billRef: invoice.billRef,
        previousOutstanding: Number(invoice.outstandingAmount),
      },
    });
    revalidatePath(`/clients/${invoice.clientCompanyId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
