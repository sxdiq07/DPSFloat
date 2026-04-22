import { Resend } from "resend";
import { formatINR } from "@/lib/currency";
import { formatInTimeZone } from "date-fns-tz";
import { buildUpiQr } from "@/lib/upi-qr";

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

export interface PaymentDetails {
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  upiId?: string | null;
  /** Firm / payee name for the UPI intent — usually the firm name. */
  payeeName?: string | null;
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

export function renderTemplate(template: ReminderTemplate, v: ReminderVars) {
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
 * Render the "Pay us" block that drops into the email body when the
 * firm has bank / UPI details on file. QR code is generated inline
 * and embedded as a data URL so no external image hosting is needed.
 */
async function renderPaymentBlock(
  payment: PaymentDetails,
  amount: number,
  note: string,
): Promise<string> {
  const hasBank =
    Boolean(payment.bankName) ||
    Boolean(payment.bankAccountNumber) ||
    Boolean(payment.bankIfsc);
  const hasUpi = Boolean(payment.upiId);
  if (!hasBank && !hasUpi) return "";

  const bankRows: string[] = [];
  if (payment.bankName) bankRows.push(row("Bank", payment.bankName));
  if (payment.bankAccountName)
    bankRows.push(row("Account name", payment.bankAccountName));
  if (payment.bankAccountNumber)
    bankRows.push(row("Account number", payment.bankAccountNumber));
  if (payment.bankIfsc) bankRows.push(row("IFSC", payment.bankIfsc));
  if (payment.upiId) bankRows.push(row("UPI", payment.upiId));

  let qrHtml = "";
  if (hasUpi && payment.upiId) {
    try {
      const { dataUrl } = await buildUpiQr(
        {
          vpa: payment.upiId,
          payeeName: payment.payeeName ?? "CredFloat",
          amount: amount > 0 ? amount : undefined,
          note,
        },
        180,
      );
      qrHtml = `<td style="vertical-align:top;padding-left:16px;width:150px;text-align:center">
        <img src="${dataUrl}" alt="UPI QR" width="150" height="150" style="display:block;margin:0 auto"/>
        <div style="font-size:10px;color:#888;margin-top:4px">Scan any UPI app</div>
      </td>`;
    } catch {
      qrHtml = "";
    }
  }

  return `
<div style="margin:22px 0 16px;border:1px solid #dedede;border-radius:8px;padding:14px 18px;background:#fafafa">
  <div style="font-weight:600;font-size:13px;color:#333;margin-bottom:8px">Pay us</div>
  <table style="border-collapse:collapse;width:100%"><tr>
    <td style="vertical-align:top"><table style="border-collapse:collapse">${bankRows.join("")}</table></td>
    ${qrHtml}
  </tr></table>
</div>`;
}

function row(k: string, v: string): string {
  return `<tr>
    <td style="padding:4px 14px 4px 0;color:#777;font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em">${escape(k)}</td>
    <td style="padding:4px 0;font-size:13px;font-weight:500;color:#222">${escape(v)}</td>
  </tr>`;
}

/**
 * Send a reminder email. Returns provider message ID on success.
 * If RESEND_API_KEY is not configured, logs to console and returns a
 * stub ID (useful for demos). Attachments, when provided, are passed
 * through to Resend — each is a {filename, content} pair with raw bytes.
 */
export async function sendReminderEmail(args: {
  to: string;
  template: ReminderTemplate;
  vars: ReminderVars;
  attachments?: Array<{ filename: string; content: Buffer }>;
  /** Bank + UPI details that render as a "Pay us" block inside the email. */
  payment?: PaymentDetails;
}): Promise<{ id: string; stubbed?: boolean }> {
  const rendered = renderTemplate(args.template, args.vars);

  // Inject the "Pay us" block just before the sign-off paragraph. The
  // template's HTML ends with `<p>Regards,…</p>` or similar — we splice
  // the payment block right before that closing block so it reads as
  // the last piece of information the debtor sees before the sign-off.
  let html = rendered.html;
  if (args.payment) {
    const payBlock = await renderPaymentBlock(
      args.payment,
      args.vars.amount,
      `Invoice ${args.vars.billRef}`,
    );
    if (payBlock) {
      const signoffIdx = html.lastIndexOf("<p>Regards,");
      const anchor =
        signoffIdx >= 0 ? signoffIdx : html.lastIndexOf("<p>Warm regards,");
      if (anchor > 0) {
        html = html.slice(0, anchor) + payBlock + html.slice(anchor);
      } else {
        // Fallback — append before closing body if sign-off not found.
        html = html.replace("</body>", payBlock + "</body>");
      }
    }
  }

  if (!resend) {
    console.log("[EMAIL STUB]", {
      to: args.to,
      subject: rendered.subject,
      template: args.template,
      attachments: args.attachments?.map((a) => ({
        filename: a.filename,
        bytes: a.content.byteLength,
      })),
    });
    return { id: `stub-${Date.now()}`, stubbed: true };
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
    to: args.to,
    subject: rendered.subject,
    text: rendered.text,
    html,
    attachments: args.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });

  if (error) throw new Error(`Resend error: ${error.message}`);
  return { id: data?.id ?? "unknown" };
}
