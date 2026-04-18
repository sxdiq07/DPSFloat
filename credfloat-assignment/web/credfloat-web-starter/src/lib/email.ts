import { Resend } from "resend";
import { formatINR } from "@/lib/currency";
import { formatInTimeZone } from "date-fns-tz";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export type ReminderTemplate = "gentle" | "followup" | "final";

export interface ReminderVars {
  partyName: string;
  clientCompanyName: string;
  billRef: string;
  billDate: Date;
  dueDate: Date;
  amount: number;
  daysOverdue: number;
  contactEmail?: string;
}

/**
 * Pick a template based on how overdue the invoice is.
 */
export function selectTemplate(daysOverdue: number): ReminderTemplate {
  if (daysOverdue <= 0) return "gentle";
  if (daysOverdue <= 30) return "followup";
  return "final";
}

function fmtDate(d: Date): string {
  return formatInTimeZone(d, "Asia/Kolkata", "dd MMM yyyy");
}

function renderTemplate(template: ReminderTemplate, v: ReminderVars) {
  const amount = formatINR(v.amount);
  const billDate = fmtDate(v.billDate);
  const dueDate = fmtDate(v.dueDate);
  const brand = "DPS & Co, Chartered Accountants";

  switch (template) {
    case "gentle":
      return {
        subject: `Payment reminder — Invoice ${v.billRef}`,
        text:
          `Dear ${v.partyName},\n\n` +
          `This is a friendly reminder that invoice ${v.billRef} dated ${billDate} ` +
          `for ${amount} is due on ${dueDate}.\n\n` +
          `Kindly arrange for payment at your earliest convenience. ` +
          `Payment instructions are available in the original invoice. ` +
          `If you have already processed this payment, please ignore this message.\n\n` +
          `Thank you for your continued business.\n\n` +
          `Warm regards,\n${v.clientCompanyName}\n(Managed by ${brand})`,
        html: htmlShell(
          `Payment reminder — Invoice ${v.billRef}`,
          `<p>Dear ${escape(v.partyName)},</p>` +
            `<p>This is a friendly reminder that invoice <strong>${escape(v.billRef)}</strong> ` +
            `dated ${billDate} for <strong>${amount}</strong> is due on <strong>${dueDate}</strong>.</p>` +
            `<p>Kindly arrange for payment at your earliest convenience. Payment instructions ` +
            `are available in the original invoice. If you have already processed this payment, ` +
            `please ignore this message.</p>` +
            `<p>Thank you for your continued business.</p>` +
            `<p>Warm regards,<br/><strong>${escape(v.clientCompanyName)}</strong><br/>` +
            `<em style="color:#666;font-size:0.9em">Managed by ${brand}</em></p>`,
        ),
      };

    case "followup":
      return {
        subject: `Payment follow-up — Invoice ${v.billRef} (${amount} overdue)`,
        text:
          `Dear ${v.partyName},\n\n` +
          `We note that invoice ${v.billRef} dated ${billDate} for ${amount} ` +
          `was due on ${dueDate} and is currently ${v.daysOverdue} days overdue.\n\n` +
          `We request you to settle this amount at the earliest. ` +
          `If there is any dispute or clarification required, please respond to this email ` +
          `so we can assist you promptly.\n\n` +
          `Outstanding amount: ${amount}\n` +
          `Invoice date: ${billDate}\n` +
          `Due date: ${dueDate}\n` +
          `Days overdue: ${v.daysOverdue}\n\n` +
          `We look forward to your prompt settlement.\n\n` +
          `Regards,\n${v.clientCompanyName}`,
        html: htmlShell(
          `Payment follow-up — Invoice ${v.billRef}`,
          `<p>Dear ${escape(v.partyName)},</p>` +
            `<p>We note that invoice <strong>${escape(v.billRef)}</strong> dated ${billDate} ` +
            `for <strong>${amount}</strong> was due on ${dueDate} and is currently ` +
            `<strong style="color:#b85c00">${v.daysOverdue} days overdue</strong>.</p>` +
            `<p>We request you to settle this amount at the earliest. If there is any dispute ` +
            `or clarification required, please respond to this email so we can assist you promptly.</p>` +
            detailsBox([
              ["Outstanding amount", amount],
              ["Invoice date", billDate],
              ["Due date", dueDate],
              ["Days overdue", `${v.daysOverdue}`],
            ]) +
            `<p>We look forward to your prompt settlement.</p>` +
            `<p>Regards,<br/><strong>${escape(v.clientCompanyName)}</strong></p>`,
        ),
      };

    case "final":
      return {
        subject: `URGENT — Outstanding payment for Invoice ${v.billRef}`,
        text:
          `Dear ${v.partyName},\n\n` +
          `This is a final reminder regarding invoice ${v.billRef} dated ${billDate} ` +
          `for ${amount}, which has been outstanding for ${v.daysOverdue} days.\n\n` +
          `Despite previous communications, we have not received payment or response. ` +
          `We urge you to settle this invoice within 7 days of receiving this notice.\n\n` +
          `Outstanding: ${amount}\n` +
          `Days overdue: ${v.daysOverdue}\n\n` +
          `If you have a genuine concern about this invoice, please contact us immediately ` +
          `at ${v.contactEmail ?? "the above email address"}.\n\n` +
          `Regards,\n${v.clientCompanyName}`,
        html: htmlShell(
          `URGENT — Outstanding payment for Invoice ${v.billRef}`,
          `<p>Dear ${escape(v.partyName)},</p>` +
            `<p>This is a <strong>final reminder</strong> regarding invoice ` +
            `<strong>${escape(v.billRef)}</strong> dated ${billDate} for <strong>${amount}</strong>, ` +
            `which has been outstanding for <strong style="color:#c01a1a">${v.daysOverdue} days</strong>.</p>` +
            `<p>Despite previous communications, we have not received payment or response. ` +
            `We urge you to settle this invoice within 7 days of receiving this notice.</p>` +
            detailsBox([
              ["Outstanding", amount],
              ["Days overdue", `${v.daysOverdue}`],
            ]) +
            `<p>If you have a genuine concern about this invoice, please contact us immediately ` +
            `${v.contactEmail ? `at <a href="mailto:${escape(v.contactEmail)}">${escape(v.contactEmail)}</a>` : ""}.</p>` +
            `<p>Regards,<br/><strong>${escape(v.clientCompanyName)}</strong></p>`,
        ),
      };
  }
}

function escape(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c] || c);
}

function detailsBox(rows: [string, string][]): string {
  const rowsHtml = rows
    .map(
      ([k, val]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#666">${escape(k)}</td>` +
        `<td style="padding:6px 0;font-weight:500">${escape(val)}</td></tr>`,
    )
    .join("");
  return `<table style="border:1px solid #e5e5e5;border-radius:6px;padding:8px 16px;margin:16px 0">${rowsHtml}</table>`;
}

function htmlShell(title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escape(title)}</title></head>
<body style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:600px;margin:20px auto;padding:20px;color:#333;line-height:1.5">
${body}
<hr style="margin-top:32px;border:none;border-top:1px solid #e5e5e5"/>
<p style="font-size:11px;color:#999">If you believe you received this email in error, reply with STOP to opt out of future reminders.</p>
</body></html>`;
}

/**
 * Send a reminder email. Returns provider message ID on success.
 * If RESEND_API_KEY is not configured, logs to console and returns a stub ID (useful for demos).
 */
export async function sendReminderEmail(args: {
  to: string;
  template: ReminderTemplate;
  vars: ReminderVars;
}): Promise<{ id: string; stubbed?: boolean }> {
  const rendered = renderTemplate(args.template, args.vars);

  if (!resend) {
    console.log("[EMAIL STUB]", {
      to: args.to,
      subject: rendered.subject,
      template: args.template,
    });
    return { id: `stub-${Date.now()}`, stubbed: true };
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
    to: args.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return { id: data?.id ?? "unknown" };
}
