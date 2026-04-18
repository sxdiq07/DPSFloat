import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { daysOverdue } from "@/lib/ageing";
import { sendReminderEmail, selectTemplate } from "@/lib/email";
import { sendWhatsAppReminder } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

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
      clientCompany: true,
    },
  });

  for (const rule of rules) {
    // For each trigger day offset, check if any invoices match today
    const triggerDays = rule.triggerDays;

    // Find this client's OPEN invoices with a due date
    const invoices = await prisma.invoice.findMany({
      where: {
        clientCompanyId: rule.clientCompanyId,
        status: "OPEN",
        dueDate: { not: null },
        party: { optedOut: false },
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
            const r = await sendReminderEmail({
              to: inv.party.email,
              template: selectTemplate(overdue),
              vars,
            });
            providerId = r.id;
          } else if (channel === "WHATSAPP" && inv.party.whatsappNumber) {
            const r = await sendWhatsAppReminder({
              to: inv.party.whatsappNumber,
              partyName: vars.partyName,
              billRef: vars.billRef,
              amount: vars.amount,
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

  return NextResponse.json({
    sent,
    failed,
    errors: errors.slice(0, 20),
    timestamp: new Date().toISOString(),
  });
}
