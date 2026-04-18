import { formatINR } from "@/lib/currency";

/**
 * Meta WhatsApp Cloud API wrapper.
 *
 * For the demo, this uses Meta's free test number which can send to up to 5
 * pre-verified recipient numbers. For production, switch to an Indian BSP
 * (AiSensy, Interakt) that handles template approvals and opt-in flows.
 *
 * Template requirement: the template referenced by `templateName` must be
 * pre-approved in Meta Business Manager. Here we assume a template named
 * "payment_reminder" with three body variables: {{1}} = party name,
 * {{2}} = bill ref, {{3}} = amount formatted.
 */

interface SendResult {
  id: string;
  stubbed?: boolean;
}

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const enabled = Boolean(PHONE_NUMBER_ID && ACCESS_TOKEN);

export async function sendWhatsAppReminder(args: {
  to: string; // E.164 format, e.g. 919876543210
  partyName: string;
  billRef: string;
  amount: number;
  templateName?: string;
  languageCode?: string;
}): Promise<SendResult> {
  const templateName = args.templateName ?? "payment_reminder";
  const languageCode = args.languageCode ?? "en";

  // Normalize phone number — strip spaces, dashes, +
  const to = args.to.replace(/[\s\-+]/g, "");

  if (!enabled) {
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
