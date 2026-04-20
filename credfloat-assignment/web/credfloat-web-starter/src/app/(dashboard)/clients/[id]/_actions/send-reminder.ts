"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { daysOverdue, getISTToday } from "@/lib/ageing";
import { sendReminderEmail, selectTemplate } from "@/lib/email";
import { sendWhatsAppReminder } from "@/lib/whatsapp";

const schema = z.object({
  invoiceId: z.string(),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
});

export type SendReminderResult =
  | { ok: true; stubbed?: boolean; clickUrl?: string }
  | { ok: false; error: string };

/**
 * Manual "send now" from the client detail page. Mirrors the cron's logic
 * but fires for a single invoice + channel on demand, so staff can
 * demonstrate or escalate without waiting for the 9:30 IST run.
 *
 * Honors opt-out, dedupes against today's sends at the DB level (partial
 * unique index on ReminderSent), and records the attempt either way.
 */
export async function sendReminderNow(
  input: z.infer<typeof schema>,
): Promise<SendReminderResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const session = await requireAuth();
  const firmId = await requireFirmId();

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: parsed.data.invoiceId,
      clientCompany: { firmId },
    },
    include: {
      party: true,
      clientCompany: true,
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found" };
  if (invoice.status !== "OPEN")
    return { ok: false, error: "Invoice is not open" };
  if (invoice.party.optedOut)
    return { ok: false, error: "Debtor has opted out of reminders" };

  const today = getISTToday();
  const overdue = invoice.dueDate ? daysOverdue(invoice.dueDate, today) : 0;

  const alreadySent = await prisma.reminderSent.findFirst({
    where: {
      invoiceId: invoice.id,
      channel: parsed.data.channel,
      sentAt: { gte: today },
      status: { in: ["SENT", "DELIVERED", "READ"] },
    },
  });
  if (alreadySent)
    return {
      ok: false,
      error: "A reminder on this invoice + channel was already sent today.",
    };

  const partyName = invoice.party.mailingName || invoice.party.tallyLedgerName;
  const vars = {
    partyName,
    clientCompanyName: invoice.clientCompany.displayName,
    billRef: invoice.billRef,
    billDate: invoice.billDate,
    dueDate: invoice.dueDate ?? invoice.billDate,
    amount: Number(invoice.outstandingAmount),
    daysOverdue: overdue,
  };

  try {
    if (parsed.data.channel === "EMAIL") {
      if (!invoice.party.email)
        return { ok: false, error: "No email on file for this debtor." };
      const r = await sendReminderEmail({
        to: invoice.party.email,
        template: selectTemplate(overdue),
        vars,
      });
      await prisma.reminderSent.create({
        data: {
          partyId: invoice.partyId,
          invoiceId: invoice.id,
          channel: "EMAIL",
          providerId: r.id,
          status: "SENT",
        },
      });
      await logActivity({
        firmId,
        actorId: session.user.id,
        action: "reminder.sent_manual",
        targetType: "Invoice",
        targetId: invoice.id,
        meta: { channel: "EMAIL", stubbed: r.stubbed ?? false },
      });
      revalidatePath(`/clients/${invoice.clientCompanyId}`);
      return { ok: true, stubbed: r.stubbed };
    }

    // WHATSAPP
    const to = invoice.party.whatsappNumber ?? invoice.party.phone ?? "";
    if (!to)
      return {
        ok: false,
        error: "No WhatsApp or phone number on file for this debtor.",
      };
    const r = await sendWhatsAppReminder({
      to,
      partyName,
      billRef: invoice.billRef,
      amount: Number(invoice.outstandingAmount),
      clickContext: {
        clientCompanyName: invoice.clientCompany.displayName,
        billDate: invoice.billDate,
        dueDate: invoice.dueDate ?? invoice.billDate,
        daysOverdue: overdue,
      },
    });
    await prisma.reminderSent.create({
      data: {
        partyId: invoice.partyId,
        invoiceId: invoice.id,
        channel: "WHATSAPP",
        providerId: r.id,
        status: "SENT",
      },
    });
    await logActivity({
      firmId,
      actorId: session.user.id,
      action: "reminder.sent_manual",
      targetType: "Invoice",
      targetId: invoice.id,
      meta: {
        channel: "WHATSAPP",
        clickToChat: Boolean(r.clickUrl),
        stubbed: r.stubbed ?? false,
      },
    });
    revalidatePath(`/clients/${invoice.clientCompanyId}`);
    return { ok: true, stubbed: r.stubbed, clickUrl: r.clickUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.reminderSent.create({
      data: {
        partyId: invoice.partyId,
        invoiceId: invoice.id,
        channel: parsed.data.channel,
        status: "FAILED",
        error: msg.slice(0, 500),
      },
    });
    return { ok: false, error: msg };
  }
}
