"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { daysOverdue, getISTToday } from "@/lib/ageing";
import { sendReminderEmail, selectTemplate } from "@/lib/email";
import { sendWhatsAppReminder } from "@/lib/whatsapp";
import { buildLedgerStatement } from "@/lib/ledger-data";
import { renderLedgerPdf } from "@/lib/ledger-pdf";
import { signLedgerToken, type LedgerPeriod } from "@/lib/ledger-token";
import type { LedgerPeriodType } from "@prisma/client";

const schema = z.object({
  invoiceId: z.string(),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  // Optional staff-typed overrides from the Preview modal. When set,
  // they replace the auto-rendered body / subject on that channel.
  emailSubjectOverride: z.string().max(200).optional(),
  emailBodyOverride: z.string().max(5000).optional(),
  whatsappBodyOverride: z.string().max(4000).optional(),
  /** Whether the "Pay us" bank+QR block is rendered inside the email /
   *  WhatsApp body. Defaults to true; staff can uncheck in the modal. */
  includePayBlock: z.boolean().optional().default(true),
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
      clientCompany: {
        include: {
          reminderRules: {
            where: { enabled: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
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

  // Resolve reminder rule → ledger period. If attachLedger is on (and
  // by default it is), we render a PDF and either attach it to the
  // email or ship a signed /api/ledger/<token> link via WhatsApp text.
  const rule = invoice.clientCompany.reminderRules[0];
  const attachLedger = rule?.attachLedger ?? true;
  const period: LedgerPeriod = resolvePeriodFromRule(
    rule?.ledgerPeriodType ?? "FY_TO_DATE",
    rule?.ledgerPeriodStart ?? null,
    rule?.ledgerPeriodEnd ?? null,
  );

  try {
    if (parsed.data.channel === "EMAIL") {
      if (!invoice.party.email)
        return { ok: false, error: "No email on file for this debtor." };

      let attachments:
        | Array<{ filename: string; content: Buffer }>
        | undefined;
      if (attachLedger) {
        try {
          const statement = await buildLedgerStatement(invoice.partyId, period);
          if (statement) {
            const pdf = await renderLedgerPdf(statement, {
              bankName: statement.firm.bankName,
              bankAccountName: statement.firm.bankAccountName,
              bankAccountNumber: statement.firm.bankAccountNumber,
              bankIfsc: statement.firm.bankIfsc,
              upiId: statement.firm.upiId,
            });
            const safeName = statement.party.name
              .replace(/[^A-Za-z0-9_-]+/g, "_")
              .slice(0, 50);
            attachments = [
              {
                filename: `${safeName}_ledger_${statement.period.to}.pdf`,
                content: pdf,
              },
            ];
          }
        } catch (err) {
          // Don't block the email on a PDF failure — send reminder body
          // anyway, log the render issue for follow-up.
          console.error(
            "[LEDGER_PDF_ERROR]",
            invoice.partyId,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      // Fetch firm bank details once to render the "Pay us" block in
      // the email body. Same Prisma Firm row that drives the PDF.
      const firm = await prisma.firm.findUnique({
        where: { id: firmId },
        select: {
          name: true,
          bankName: true,
          bankAccountName: true,
          bankAccountNumber: true,
          bankIfsc: true,
          upiId: true,
        },
      });
      const r = await sendReminderEmail({
        to: invoice.party.email,
        template: selectTemplate(overdue),
        vars,
        attachments,
        subjectOverride: parsed.data.emailSubjectOverride,
        bodyOverride: parsed.data.emailBodyOverride,
        payment:
          firm && parsed.data.includePayBlock
            ? {
                bankName: firm.bankName,
                bankAccountName: firm.bankAccountName,
                bankAccountNumber: firm.bankAccountNumber,
                bankIfsc: firm.bankIfsc,
                upiId: firm.upiId,
                payeeName: firm.name,
              }
            : undefined,
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

    // Include a signed 48h ledger-PDF link in the pre-filled message
    // (click-to-chat mode) / template body (API mode). The debtor taps
    // the link to download the statement — no attachment uploads needed
    // for click-to-chat.
    let ledgerUrl: string | undefined;
    if (attachLedger) {
      const token = signLedgerToken({ partyId: invoice.partyId, period });
      const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      ledgerUrl = `${base}/api/ledger/${token}`;
    }

    const r = await sendWhatsAppReminder({
      to,
      partyName,
      billRef: invoice.billRef,
      amount: Number(invoice.outstandingAmount),
      ledgerUrl,
      bodyOverride: parsed.data.whatsappBodyOverride,
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

function resolvePeriodFromRule(
  type: LedgerPeriodType,
  start: Date | null,
  end: Date | null,
): LedgerPeriod {
  if (type === "CUSTOM") {
    if (!start || !end) return { type: "FY_TO_DATE" };
    return { type: "CUSTOM", start: start.toISOString(), end: end.toISOString() };
  }
  return { type };
}
