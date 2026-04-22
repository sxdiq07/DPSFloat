import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { daysOverdue, getISTToday } from "@/lib/ageing";
import { sendReminderEmail, selectTemplate } from "@/lib/email";
import { sendWhatsAppReminder } from "@/lib/whatsapp";
import { isIndianHoliday, todayISTString } from "@/lib/holidays";
import { buildLedgerStatement } from "@/lib/ledger-data";
import { renderLedgerPdf } from "@/lib/ledger-pdf";
import { signLedgerToken, type LedgerPeriod } from "@/lib/ledger-token";
import type { LedgerPeriodType } from "@prisma/client";
import { recordCronRun } from "@/lib/cron";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Don't dispatch reminders on major Indian holidays — reads as tone-deaf.
  // Recorded as a CronRun so "why was nothing sent today?" is answerable.
  if (isIndianHoliday()) {
    await recordCronRun("send-reminders", async () => ({
      rowsAffected: 0,
      meta: { skipped: "holiday", istDate: todayISTString() },
    }));
    return NextResponse.json({
      sent: 0,
      failed: 0,
      skipped: "holiday",
      istDate: todayISTString(),
      timestamp: new Date().toISOString(),
    });
  }

  const outcome = await recordCronRun("send-reminders", async () => {
  const today = getISTToday();
  const startOfToday = today;

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  // Find all active reminder rules with enabled = true
  const rules = await prisma.reminderRule.findMany({
    where: {
      enabled: true,
      clientCompany: { status: "ACTIVE" },
    },
    include: {
      clientCompany: { include: { firm: true } },
    },
  });

  for (const rule of rules) {
    // For each trigger day offset, check if any invoices match today
    const triggerDays = rule.triggerDays;

    // Find this client's OPEN invoices with a due date AND a non-zero
    // outstanding. An invoice whose allocation engine zero'd it out in
    // the last sync stays OPEN only briefly (the engine flips it to PAID)
    // — the outstandingAmount > 0 filter is belt-and-braces so a
    // partially-settled bill still reminds, but a fully-paid one doesn't.
    const invoices = await prisma.invoice.findMany({
      where: {
        clientCompanyId: rule.clientCompanyId,
        status: "OPEN",
        outstandingAmount: { gt: 0 },
        dueDate: { not: null },
        deletedAt: null,
        party: { optedOut: false, deletedAt: null },
      },
      include: { party: true },
    });

    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      const overdue = daysOverdue(inv.dueDate, today);
      // Only dispatch if today equals one of the trigger days
      if (!triggerDays.includes(overdue)) continue;

      // Build reminder variables
      const vars = {
        partyName: inv.party.mailingName || inv.party.tallyLedgerName,
        clientCompanyName: rule.clientCompany.displayName,
        billRef: inv.billRef,
        billDate: inv.billDate,
        dueDate: inv.dueDate,
        amount: Number(inv.outstandingAmount),
        daysOverdue: overdue,
      };

      // Resolve ledger attachment once per invoice — same settings drive
      // every channel for this debtor. Render the PDF lazily (only for
      // email) but sign the token upfront so WhatsApp gets a URL.
      const attachLedger = rule.attachLedger;
      const period = resolvePeriodFromRule(
        rule.ledgerPeriodType,
        rule.ledgerPeriodStart,
        rule.ledgerPeriodEnd,
      );
      let ledgerPdf: Buffer | undefined;
      let ledgerFilename: string | undefined;
      let ledgerUrl: string | undefined;
      if (attachLedger) {
        const token = signLedgerToken({ partyId: inv.partyId, period });
        const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
        ledgerUrl = `${base}/api/ledger/${token}`;
      }

      // Dispatch on each enabled channel, skipping if already sent today
      for (const channel of rule.channels) {
        // Idempotency: skip if a reminder on this invoice+channel was sent today
        const alreadySent = await prisma.reminderSent.findFirst({
          where: {
            invoiceId: inv.id,
            channel,
            sentAt: { gte: startOfToday },
          },
        });
        if (alreadySent) continue;

        try {
          let providerId = "";
          if (channel === "EMAIL" && inv.party.email) {
            // Render the PDF on first email-channel hit for this invoice.
            // Other same-invoice channels reuse the buffer.
            let attachments:
              | Array<{ filename: string; content: Buffer }>
              | undefined;
            if (attachLedger) {
              if (!ledgerPdf) {
                try {
                  const statement = await buildLedgerStatement(
                    inv.partyId,
                    period,
                  );
                  if (statement) {
                    ledgerPdf = await renderLedgerPdf(statement, {
                      bankName: statement.firm.bankName,
                      bankAccountName: statement.firm.bankAccountName,
                      bankAccountNumber: statement.firm.bankAccountNumber,
                      bankIfsc: statement.firm.bankIfsc,
                      upiId: statement.firm.upiId,
                    });
                    const safe = statement.party.name
                      .replace(/[^A-Za-z0-9_-]+/g, "_")
                      .slice(0, 50);
                    ledgerFilename = `${safe}_ledger_${statement.period.to}.pdf`;
                  }
                } catch (err) {
                  // Preserve the email send — just skip the attachment.
                  console.error(
                    "[LEDGER_PDF_ERROR]",
                    inv.partyId,
                    err instanceof Error ? err.message : String(err),
                  );
                }
              }
              if (ledgerPdf && ledgerFilename) {
                attachments = [
                  { filename: ledgerFilename, content: ledgerPdf },
                ];
              }
            }
            const firm = rule.clientCompany.firm;
            const r = await sendReminderEmail({
              to: inv.party.email,
              template: selectTemplate(overdue),
              vars,
              attachments,
              payment: {
                bankName: firm.bankName,
                bankAccountName: firm.bankAccountName,
                bankAccountNumber: firm.bankAccountNumber,
                bankIfsc: firm.bankIfsc,
                upiId: firm.upiId,
                payeeName: firm.name,
              },
            });
            providerId = r.id;
          } else if (
            channel === "WHATSAPP" &&
            (inv.party.whatsappNumber || inv.party.phone)
          ) {
            // In click-to-chat mode (no Meta API creds), the cron can't
            // actually dispatch — a human has to click. Skip silently so
            // the reminder shows up in the UI's "send now" queue instead.
            if (!process.env.WHATSAPP_ACCESS_TOKEN) continue;
            const r = await sendWhatsAppReminder({
              to: inv.party.whatsappNumber ?? inv.party.phone ?? "",
              partyName: vars.partyName,
              billRef: vars.billRef,
              amount: vars.amount,
              ledgerUrl,
            });
            providerId = r.id;
          } else if (channel === "SMS") {
            // SMS deferred until DLT templates are approved. Stub for now.
            console.log("[SMS STUB]", inv.party.phone, vars);
            providerId = `sms-stub-${Date.now()}`;
          } else {
            // Missing contact info; skip silently
            continue;
          }

          await prisma.reminderSent.create({
            data: {
              partyId: inv.partyId,
              invoiceId: inv.id,
              channel,
              providerId,
              status: "SENT",
            },
          });
          sent++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${channel}/${inv.billRef}: ${msg}`);
          await prisma.reminderSent.create({
            data: {
              partyId: inv.partyId,
              invoiceId: inv.id,
              channel,
              status: "FAILED",
              error: msg.slice(0, 500),
            },
          });
        }
      }
    }
  }

    return {
      rowsAffected: sent,
      meta: { sent, failed, errors: errors.slice(0, 20) },
    };
  });

  const meta = (outcome.meta ?? {}) as {
    sent?: number;
    failed?: number;
    errors?: string[];
  };
  return NextResponse.json({
    sent: meta.sent ?? 0,
    failed: meta.failed ?? 0,
    errors: meta.errors ?? [],
    timestamp: new Date().toISOString(),
  });
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
