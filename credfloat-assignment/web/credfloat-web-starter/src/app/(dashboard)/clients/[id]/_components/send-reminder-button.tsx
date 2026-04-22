"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail, MessageCircle, Send, Loader2, Eye } from "lucide-react";
import { sendReminderNow } from "../_actions/send-reminder";
import {
  previewReminder,
  type ReminderPreview,
} from "../_actions/preview-reminder";
import { ReminderPreviewModal } from "./reminder-preview-modal";

type Props = {
  invoiceId: string;
  hasEmail: boolean;
  hasWhatsApp: boolean;
};

export function SendReminderButton({
  invoiceId,
  hasEmail,
  hasWhatsApp,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startPending] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<ReminderPreview | null>(null);

  // Popover position in viewport coords. Computed when opening so the
  // menu renders in `position: fixed` and escapes the parent card's
  // `overflow-hidden`. Flip above the button when near the bottom of
  // the viewport so last-row clicks don't clip off-screen.
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    right: number;
    openUp: boolean;
  } | null>(null);

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const menuH = 160; // approx height
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < menuH + 24;
      setMenuPos({
        top: openUp ? rect.top - 6 : rect.bottom + 6,
        right: window.innerWidth - rect.right,
        openUp,
      });
    }
    setOpen(true);
  };

  // Close on scroll / resize so the menu doesn't float over stale coords.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const onPreview = () => {
    setOpen(false);
    setPreview(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    previewReminder({ invoiceId })
      .then((r) => {
        if (!r.ok) {
          toast.error(r.error);
          setPreviewOpen(false);
          return;
        }
        setPreview(r.preview);
      })
      .finally(() => setPreviewLoading(false));
  };

  if (!hasEmail && !hasWhatsApp) {
    return (
      <span className="text-[11px] text-ink-3" title="No contact info on file">
        —
      </span>
    );
  }

  const dispatch = (channel: "EMAIL" | "WHATSAPP") => {
    setOpen(false);
    startPending(async () => {
      // Quick-send path — always include the "Pay us" block. Staff who
      // want to edit or skip the block open the Preview modal instead.
      const r = await sendReminderNow({
        invoiceId,
        channel,
        includePayBlock: true,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.clickUrl) {
        // Click-to-chat mode: open WhatsApp with the message pre-filled.
        window.open(r.clickUrl, "_blank", "noopener,noreferrer");
        toast.success("WhatsApp opened with message ready — hit send.");
        return;
      }
      if (r.stubbed) {
        toast.success(
          channel === "EMAIL"
            ? "Email reminder logged (no RESEND_API_KEY — set one to actually send)."
            : "WhatsApp reminder logged (stubbed).",
        );
        return;
      }
      toast.success(
        channel === "EMAIL"
          ? "Email reminder sent."
          : "WhatsApp reminder sent.",
      );
    });
  };

  return (
    <div className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        disabled={pending}
        onClick={toggleOpen}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Send className="h-3 w-3" />
        )}
        Send
      </button>
      {open && menuPos && (
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="min-w-[200px] overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-white py-1 shadow-lg"
            style={{
              position: "fixed",
              zIndex: 9999,
              top: menuPos.openUp ? "auto" : menuPos.top,
              bottom: menuPos.openUp
                ? window.innerHeight - menuPos.top
                : "auto",
              right: menuPos.right,
            }}
          >
            <button
              type="button"
              onClick={onPreview}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-[var(--color-surface-3)] hover:text-ink"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview message
            </button>
            <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
            <button
              type="button"
              disabled={!hasEmail}
              onClick={() => dispatch("EMAIL")}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-[var(--color-surface-3)] hover:text-ink disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent"
            >
              <Mail className="h-3.5 w-3.5" />
              Send email
              {!hasEmail && (
                <span className="ml-auto text-[10px] text-ink-3">
                  no email
                </span>
              )}
            </button>
            <button
              type="button"
              disabled={!hasWhatsApp}
              onClick={() => dispatch("WHATSAPP")}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-[var(--color-surface-3)] hover:text-ink disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Send WhatsApp
              {!hasWhatsApp && (
                <span className="ml-auto text-[10px] text-ink-3">no number</span>
              )}
            </button>
          </div>
        </>
      )}
      <ReminderPreviewModal
        open={previewOpen}
        loading={previewLoading}
        preview={preview}
        invoiceId={invoiceId}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}
