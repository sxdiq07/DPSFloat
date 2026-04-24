"use client";

import { useState, useTransition } from "react";
import {
  Share2,
  Loader2,
  Copy,
  FileText,
  FileDown,
  MessageCircle,
  Mail,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { createInvoiceShareLinks } from "../_actions/share-invoice";

/**
 * Single "Share" button on each invoice row. Opens a menu with:
 *   - Download PDF (new tab)
 *   - Copy public web link
 *   - Open WhatsApp with pre-filled message
 *   - Open email client with pre-filled message
 *
 * All four paths use the same HMAC-signed token (48h TTL); the
 * menu is just the packaging.
 */
export function InvoiceShareButton({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startPending] = useTransition();
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<{
    webUrl: string;
    pdfUrl: string;
    whatsappUrl: string;
    emailUrl: string;
  } | null>(null);

  const ensureLinks = async (): Promise<typeof links> => {
    if (links) return links;
    return new Promise((resolve) => {
      startPending(async () => {
        const r = await createInvoiceShareLinks({ invoiceId });
        if (!r.ok) {
          toast.error(r.error);
          resolve(null);
          return;
        }
        const { webUrl, pdfUrl, whatsappUrl, emailUrl } = r;
        const next = { webUrl, pdfUrl, whatsappUrl, emailUrl };
        setLinks(next);
        resolve(next);
      });
    });
  };

  const onToggle = async () => {
    if (!open) await ensureLinks();
    setOpen((s) => !s);
  };

  const onCopy = async () => {
    const l = await ensureLinks();
    if (!l) return;
    await navigator.clipboard.writeText(l.webUrl);
    setCopied(true);
    toast.success("Link copied");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        title="Share invoice"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-3 transition-all hover:border-sky-300 hover:text-sky-700 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Share2 className="h-3 w-3" />
        )}
      </button>
      {open && links && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute right-0 top-7 z-50 w-56 overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] shadow-[var(--shadow-apple-md)]"
          >
            <a
              href={links.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-ink-2 hover:bg-[var(--color-surface-2)]"
            >
              <FileText className="h-3.5 w-3.5 text-ink-3" />
              Download PDF
            </a>
            <a
              href={`${links.pdfUrl}?as=tax`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-ink-2 hover:bg-[var(--color-surface-2)]"
              title="Render as formal GST Tax Invoice (CGST/SGST breakdown, HSN summary, PAN, signatory)"
            >
              <FileDown className="h-3.5 w-3.5 text-ink-3" />
              Download as Tax Invoice
            </a>
            <button
              type="button"
              onClick={onCopy}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ink-2 hover:bg-[var(--color-surface-2)]"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-ink-3" />
              )}
              {copied ? "Copied" : "Copy web link"}
            </button>
            <a
              href={links.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-ink-2 hover:bg-[var(--color-surface-2)]"
            >
              <MessageCircle className="h-3.5 w-3.5 text-ink-3" />
              Share via WhatsApp
            </a>
            <a
              href={links.emailUrl}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-ink-2 hover:bg-[var(--color-surface-2)]"
            >
              <Mail className="h-3.5 w-3.5 text-ink-3" />
              Share via Email
            </a>
          </div>
        </>
      )}
    </span>
  );
}
