"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireFirmId } from "@/lib/session";
import { signInvoiceToken } from "@/lib/invoice-token";
import { logActivity } from "@/lib/activity";

const schema = z.object({ invoiceId: z.string() });

/**
 * Mint a short-lived (48h) signed share URL for a single invoice.
 * Returns both the web URL (shown in the debtor-facing /invoice/[token]
 * page) and the PDF URL (for direct download).
 */
export async function createInvoiceShareLinks(
  input: z.infer<typeof schema>,
): Promise<
  | { ok: true; webUrl: string; pdfUrl: string; whatsappUrl: string; emailUrl: string }
  | { ok: false; error: string }
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const session = await requireAuth();
  const firmId = await requireFirmId();

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: parsed.data.invoiceId,
      clientCompany: { firmId },
      deletedAt: null,
    },
    include: {
      party: true,
      clientCompany: true,
    },
  });
  if (!invoice) return { ok: false, error: "Invoice not found" };

  const token = signInvoiceToken(invoice.id);
  const base =
    process.env.APP_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const webUrl = `${base.replace(/\/$/, "")}/invoice/${token}`;
  const pdfUrl = `${base.replace(/\/$/, "")}/api/invoice/${token}`;

  const partyName = invoice.party.mailingName || invoice.party.tallyLedgerName;
  const amountINR = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Number(invoice.outstandingAmount));

  const message =
    `Dear ${partyName}, this is a payment reminder for invoice ` +
    `${invoice.billRef} (₹${amountINR}). ` +
    `View and pay securely: ${webUrl}`;
  const whatsappNum = (invoice.party.whatsappNumber || invoice.party.phone || "")
    .replace(/\D/g, "");
  const whatsappUrl = whatsappNum
    ? `https://wa.me/${whatsappNum}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  const emailUrl = invoice.party.email
    ? `mailto:${invoice.party.email}?subject=${encodeURIComponent(
        `Payment reminder — Invoice ${invoice.billRef}`,
      )}&body=${encodeURIComponent(message)}`
    : `mailto:?subject=${encodeURIComponent(
        `Payment reminder — Invoice ${invoice.billRef}`,
      )}&body=${encodeURIComponent(message)}`;

  await logActivity({
    firmId,
    actorId: session.user.id,
    action: "invoice.shared",
    targetType: "Invoice",
    targetId: invoice.id,
    meta: { billRef: invoice.billRef, webUrl },
  });

  return { ok: true, webUrl, pdfUrl, whatsappUrl, emailUrl };
}
