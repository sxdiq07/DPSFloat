"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireFirmId } from "@/lib/session";
import { daysOverdue, getISTToday } from "@/lib/ageing";
import { renderTemplate, selectTemplate } from "@/lib/email";
import {
  buildWhatsAppClickUrl,
  renderWhatsAppText,
} from "@/lib/whatsapp";

const schema = z.object({ invoiceId: z.string() });

export type ReminderPreview = {
  partyName: string;
  partyEmail: string | null;
  partyPhone: string | null;
  daysOverdue: number;
  template: "gentle" | "followup" | "final";
  email: {
    to: string | null;
    subject: string;
    html: string;
    text: string;
  };
  whatsapp: {
    to: string | null;
    text: string;
    clickUrl: string | null;
  };
};

export type PreviewResult =
  | { ok: true; preview: ReminderPreview }
  | { ok: false; error: string };

export async function previewReminder(
  input: z.infer<typeof schema>,
): Promise<PreviewResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

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

  const today = getISTToday();
  const overdue = invoice.dueDate ? daysOverdue(invoice.dueDate, today) : 0;
  const template = selectTemplate(overdue);
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

  const rendered = renderTemplate(template, vars);
  const waNumber = invoice.party.whatsappNumber ?? invoice.party.phone ?? null;
  const waText = renderWhatsAppText(vars);
  const waClickUrl = waNumber
    ? buildWhatsAppClickUrl({ ...vars, to: waNumber })
    : null;

  return {
    ok: true,
    preview: {
      partyName,
      partyEmail: invoice.party.email,
      partyPhone: waNumber,
      daysOverdue: overdue,
      template,
      email: {
        to: invoice.party.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      },
      whatsapp: {
        to: waNumber,
        text: waText,
        clickUrl: waClickUrl,
      },
    },
  };
}
