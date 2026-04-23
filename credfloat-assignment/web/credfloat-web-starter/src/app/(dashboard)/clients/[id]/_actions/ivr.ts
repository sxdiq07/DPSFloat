"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { startStudioCall } from "@/lib/twilio";
import { formatINR } from "@/lib/currency";

const schema = z.object({
  partyId: z.string(),
  invoiceId: z.string().optional().nullable(),
});

/**
 * Kick off a Twilio Studio IVR call for the given debtor. Optionally
 * references a specific invoice so the flow can name the bill.
 *
 * Refuses if:
 *   - debtor is opted out / archived
 *   - no phone number on file (whatsappNumber or phone)
 *   - required Twilio env vars aren't configured (hits startStudioCall)
 */
export async function initiateIvrCall(
  input: z.infer<typeof schema>,
): Promise<{ ok: true; callId: string } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const session = await requireAuth();
  const firmId = await requireFirmId();

  const party = await prisma.party.findFirst({
    where: {
      id: parsed.data.partyId,
      clientCompany: { firmId },
      deletedAt: null,
    },
    include: {
      clientCompany: { include: { firm: true } },
    },
  });
  if (!party) return { ok: false, error: "Debtor not found" };
  if (party.optedOut) {
    return { ok: false, error: "Debtor has opted out of communications" };
  }

  const toNumber = (party.whatsappNumber || party.phone || "").trim();
  if (!toNumber) {
    return {
      ok: false,
      error: "No phone number on file. Add one in Tally before dialing.",
    };
  }
  const normalized = toNumber.startsWith("+") ? toNumber : `+91${toNumber.replace(/\D/g, "")}`;

  // Optional invoice context
  let invoice: {
    id: string;
    billRef: string;
    outstandingAmount: { toString: () => string };
    dueDate: Date | null;
  } | null = null;
  if (parsed.data.invoiceId) {
    invoice = await prisma.invoice.findFirst({
      where: {
        id: parsed.data.invoiceId,
        partyId: party.id,
        deletedAt: null,
      },
      select: {
        id: true,
        billRef: true,
        outstandingAmount: true,
        dueDate: true,
      },
    });
  }

  // Build the flow parameters — authored to match what the Studio
  // flow templates (e.g. {{flow.data.partyName}}).
  const parameters: Record<string, string | number> = {
    partyName: party.mailingName || party.tallyLedgerName,
    clientCompanyName: party.clientCompany.displayName,
    firmName: party.clientCompany.firm.name,
    outstandingAmount: formatINR(Number(party.closingBalance)),
    outstandingRupees: Number(party.closingBalance).toFixed(2),
  };
  if (invoice) {
    parameters.billRef = invoice.billRef;
    parameters.billAmount = formatINR(Number(invoice.outstandingAmount));
    parameters.billAmountRupees = Number(invoice.outstandingAmount).toFixed(2);
    if (invoice.dueDate) {
      parameters.dueDate = invoice.dueDate.toISOString().slice(0, 10);
    }
  }

  // Create the CallLog row first so we always have an audit record,
  // even if the Twilio call throws.
  const callLog = await prisma.callLog.create({
    data: {
      partyId: party.id,
      invoiceId: invoice?.id ?? null,
      initiatedBy: session.user.id,
      toNumber: normalized,
      status: "QUEUED",
    },
    select: { id: true },
  });

  try {
    const exec = await startStudioCall({
      toNumber: normalized,
      parameters,
    });
    await prisma.callLog.update({
      where: { id: callLog.id },
      data: { executionSid: exec.executionSid, status: "INITIATED" },
    });
    await logActivity({
      firmId,
      actorId: session.user.id,
      action: "call.ivr_initiated",
      targetType: "Party",
      targetId: party.id,
      meta: {
        to: normalized,
        executionSid: exec.executionSid,
        invoiceId: invoice?.id ?? null,
      },
    });
    revalidatePath(`/clients/${party.clientCompanyId}`);
    return { ok: true, callId: callLog.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.callLog.update({
      where: { id: callLog.id },
      data: { status: "FAILED", error: msg.slice(0, 1000) },
    });
    return { ok: false, error: msg };
  }
}
