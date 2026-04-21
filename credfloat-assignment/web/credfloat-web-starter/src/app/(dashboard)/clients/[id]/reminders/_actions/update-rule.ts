"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { sendReminderEmail, selectTemplate } from "@/lib/email";
import { sendWhatsAppReminder } from "@/lib/whatsapp";

const channelEnum = z.enum(["EMAIL", "SMS", "WHATSAPP"]);

const ledgerPeriodEnum = z.enum([
  "FY_TO_DATE",
  "LAST_12_MONTHS",
  "OPEN_ITEMS_ONLY",
  "ALL_HISTORY",
  "CUSTOM",
]);

const ruleSchema = z.object({
  clientId: z.string().min(1),
  enabled: z.boolean(),
  triggerDays: z.array(z.number().int().min(-365).max(3650)).max(20),
  channels: z.array(channelEnum).max(3),
  emailTemplate: z.string().optional().nullable(),
  smsTemplate: z.string().max(160).optional().nullable(),
  whatsappTemplateId: z.string().optional().nullable(),
  attachLedger: z.boolean().default(true),
  ledgerPeriodType: ledgerPeriodEnum.default("FY_TO_DATE"),
  ledgerPeriodStart: z.string().optional().nullable(),
  ledgerPeriodEnd: z.string().optional().nullable(),
});

export async function updateReminderRule(
  input: z.infer<typeof ruleSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  try {
    const firmId = await requireFirmId();
    const client = await prisma.clientCompany.findFirst({
      where: { id: parsed.data.clientId, firmId },
      select: { id: true },
    });
    if (!client) return { ok: false, error: "Client not found" };

    const existing = await prisma.reminderRule.findFirst({
      where: { clientCompanyId: client.id },
      select: { id: true },
    });

    const dedupedDays = Array.from(new Set(parsed.data.triggerDays)).sort(
      (a, b) => a - b,
    );
    const dedupedChannels = Array.from(new Set(parsed.data.channels));

    // CUSTOM period needs both endpoints; other types ignore them.
    const ledgerStart =
      parsed.data.ledgerPeriodType === "CUSTOM" && parsed.data.ledgerPeriodStart
        ? new Date(parsed.data.ledgerPeriodStart)
        : null;
    const ledgerEnd =
      parsed.data.ledgerPeriodType === "CUSTOM" && parsed.data.ledgerPeriodEnd
        ? new Date(parsed.data.ledgerPeriodEnd)
        : null;

    const baseData = {
      enabled: parsed.data.enabled,
      triggerDays: dedupedDays,
      channels: dedupedChannels,
      emailTemplate: parsed.data.emailTemplate ?? null,
      smsTemplate: parsed.data.smsTemplate ?? null,
      whatsappTemplateId: parsed.data.whatsappTemplateId ?? null,
      attachLedger: parsed.data.attachLedger,
      ledgerPeriodType: parsed.data.ledgerPeriodType,
      ledgerPeriodStart: ledgerStart,
      ledgerPeriodEnd: ledgerEnd,
    };

    if (existing) {
      await prisma.reminderRule.update({
        where: { id: existing.id },
        data: baseData,
      });
    } else {
      await prisma.reminderRule.create({
        data: {
          clientCompanyId: client.id,
          ...baseData,
        },
      });
    }

    revalidatePath(`/clients/${client.id}/reminders`);
    revalidatePath(`/clients/${client.id}`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Save failed: ${msg}` };
  }
}

const testSchema = z.object({
  clientId: z.string().min(1),
  channel: channelEnum,
  to: z.string().min(3),
});

export async function sendTestReminder(
  input: z.infer<typeof testSchema>,
): Promise<{ ok: true; providerId: string } | { ok: false; error: string }> {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join(", ") };
  }

  try {
    const firmId = await requireFirmId();
    const client = await prisma.clientCompany.findFirst({
      where: { id: parsed.data.clientId, firmId },
      select: { displayName: true },
    });
    if (!client) return { ok: false, error: "Client not found" };

    const vars = {
      partyName: "Test recipient",
      clientCompanyName: client.displayName,
      billRef: "TEST-0001",
      billDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      amount: 123456,
      daysOverdue: 5,
    };

    if (parsed.data.channel === "EMAIL") {
      const r = await sendReminderEmail({
        to: parsed.data.to,
        template: selectTemplate(vars.daysOverdue),
        vars,
      });
      return { ok: true, providerId: r.id };
    }
    if (parsed.data.channel === "WHATSAPP") {
      const r = await sendWhatsAppReminder({
        to: parsed.data.to,
        partyName: vars.partyName,
        billRef: vars.billRef,
        amount: vars.amount,
      });
      return { ok: true, providerId: r.id };
    }
    // SMS — stub for now, DLT registration pending
    console.log("[SMS STUB]", parsed.data.to, vars);
    return { ok: true, providerId: `sms-stub-${Date.now()}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Send failed: ${msg}` };
  }
}
