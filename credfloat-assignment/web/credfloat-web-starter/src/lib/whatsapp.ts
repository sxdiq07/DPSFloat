import { formatINR } from "@/lib/currency";
import { formatInTimeZone } from "date-fns-tz";

/**
 * WhatsApp dispatch has two paths:
 *
 * 1. API mode (Meta Cloud API). Requires WHATSAPP_PHONE_NUMBER_ID +
 *    WHATSAPP_ACCESS_TOKEN and a pre-approved template. Good for production.
 *
 * 2. Click-to-chat mode (wa.me deep link). Zero setup, zero cost. The
 *    server returns a wa.me URL with the message pre-filled; the staff
 *    member clicks once in the UI to open WhatsApp and hit send. This is
 *    the default when no API credentials are configured — fine for free-tier
 *    demos and small firms that don't need fully automated dispatch.
 *
 * API template contract: body has three variables — {{1}} = party name,
 * {{2}} = bill ref, {{3}} = amount formatted.
 */

interface SendResult {
  id: string;
  stubbed?: boolean;
  /** Set in click-to-chat mode — UI must open this URL to actually send. */
  clickUrl?: string;
}

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const apiEnabled = Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN);

export function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-+()]/g, "");
}

/**
 * Build the message body staff would otherwise paste into WhatsApp.
 * Used by click-to-chat mode and also handy for previewing the template.
 */
export function renderWhatsAppText(args: {
  partyName: string;
  clientCompanyName: string;
  billRef: string;
  billDate: Date;
  dueDate: Date;
  amount: number;
  daysOverdue: number;
  ledgerUrl?: string;
}): string {
  const amount = formatINR(args.amount);
  const due = formatInTimeZone(args.dueDate, "Asia/Kolkata", "dd MMM yyyy");
  const head =
    args.daysOverdue > 30
      ? `Final reminder — invoice ${args.billRef} (${amount}) is ${args.daysOverdue} days overdue.`
      : args.daysOverdue > 0
        ? `Payment follow-up — invoice ${args.billRef} (${amount}) was due ${due} and is now ${args.daysOverdue} days overdue.`
        : `Friendly reminder — invoice ${args.billRef} (${amount}) is due ${due}.`;
  const ledgerLine = args.ledgerUrl
    ? `\n\nLedger statement: ${args.ledgerUrl}`
    : "";
  return (
    `Dear ${args.partyName},\n\n${head}\n\n` +
    `Please let us know if this has already been settled.${ledgerLine}\n\n` +
    `Regards,\n${args.clientCompanyName}`
  );
}

/**
 * Build a wa.me click-to-chat URL with the reminder message pre-filled.
 * Returns null if the phone number is too short to be valid (guards
 * against accidentally generating wa.me/ urls).
 */
export function buildWhatsAppClickUrl(args: {
  to: string;
  partyName: string;
  clientCompanyName: string;
  billRef: string;
  billDate: Date;
  dueDate: Date;
  amount: number;
  daysOverdue: number;
  ledgerUrl?: string;
}): string | null {
  const to = normalizePhone(args.to);
  if (to.length < 10) return null;
  const text = renderWhatsAppText(args);
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export async function sendWhatsAppReminder(args: {
  to: string; // E.164 format, e.g. 919876543210
  partyName: string;
  billRef: string;
  amount: number;
  templateName?: string;
  languageCode?: string;
  /** Public signed link to the debtor's ledger PDF (48h by default). */
  ledgerUrl?: string;
  /** Full context needed to render the click-to-chat message body. */
  clickContext?: {
    clientCompanyName: string;
    billDate: Date;
    dueDate: Date;
    daysOverdue: number;
  };
}): Promise<SendResult> {
  const templateName = args.templateName ?? "payment_reminder";
  const languageCode = args.languageCode ?? "en";

  const to = normalizePhone(args.to);

  // Click-to-chat mode: return a wa.me URL the UI opens in a new tab.
  // Preferred when no Meta API credentials are configured.
  if (!apiEnabled) {
    if (args.clickContext) {
      const clickUrl = buildWhatsAppClickUrl({
        to: args.to,
        partyName: args.partyName,
        clientCompanyName: args.clickContext.clientCompanyName,
        billRef: args.billRef,
        billDate: args.clickContext.billDate,
        dueDate: args.clickContext.dueDate,
        amount: args.amount,
        daysOverdue: args.clickContext.daysOverdue,
        ledgerUrl: args.ledgerUrl,
      });
      if (clickUrl) {
        return { id: `wa-click-${Date.now()}`, clickUrl };
      }
    }
    console.log("[WHATSAPP STUB]", {
      to,
      template: templateName,
      partyName: args.partyName,
      billRef: args.billRef,
      amount: formatINR(args.amount),
    });
    return { id: `whatsapp-stub-${Date.now()}`, stubbed: true };
  }

  const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: args.partyName },
            { type: "text", text: args.billRef },
            { type: "text", text: formatINR(args.amount) },
          ],
        },
      ],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errText}`);
  }

  const json = await res.json() as { messages?: Array<{ id: string }> };
  const messageId = json.messages?.[0]?.id ?? "unknown";
  return { id: messageId };
}
