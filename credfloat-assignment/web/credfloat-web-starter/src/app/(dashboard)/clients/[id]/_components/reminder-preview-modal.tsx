"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Mail, MessageCircle, Loader2, Send } from "lucide-react";
import type { ReminderPreview } from "../_actions/preview-reminder";
import { sendReminderNow } from "../_actions/send-reminder";

type Props = {
  open: boolean;
  loading: boolean;
  preview: ReminderPreview | null;
  invoiceId: string;
  onClose: () => void;
};

const TEMPLATE_LABEL: Record<ReminderPreview["template"], string> = {
  gentle: "Gentle — before/at due date",
  followup: "Follow-up — within 30 days overdue",
  final: "Final — 30+ days overdue",
};

export function ReminderPreviewModal({
  open,
  loading,
  preview,
  invoiceId,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"email" | "whatsapp">("email");
  const [sending, startSending] = useTransition();

  // Editable state. Initialized from `preview` when it loads; staff
  // can tweak subject / body / whatsapp text before hitting Send.
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [whatsappBody, setWhatsappBody] = useState("");

  // Reset editable fields whenever a new preview arrives (or the modal
  // reopens on a different invoice). Using a memo on preview identity
  // so typing doesn't get clobbered mid-edit.
  const previewKey = preview
    ? `${preview.partyName}|${preview.email.subject}`
    : "";
  useMemo(() => {
    if (preview) {
      setEmailSubject(preview.email.subject);
      setEmailBody(preview.email.text);
      setWhatsappBody(preview.whatsapp.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const subjectEdited =
    Boolean(preview) && emailSubject.trim() !== preview!.email.subject.trim();
  const bodyEdited =
    Boolean(preview) && emailBody.trim() !== preview!.email.text.trim();
  const whatsappEdited =
    Boolean(preview) && whatsappBody.trim() !== preview!.whatsapp.text.trim();

  const dispatch = (channel: "EMAIL" | "WHATSAPP") => {
    startSending(async () => {
      const r = await sendReminderNow({
        invoiceId,
        channel,
        emailSubjectOverride: channel === "EMAIL" && subjectEdited ? emailSubject : undefined,
        emailBodyOverride: channel === "EMAIL" && bodyEdited ? emailBody : undefined,
        whatsappBodyOverride:
          channel === "WHATSAPP" && whatsappEdited ? whatsappBody : undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.clickUrl) {
        window.open(r.clickUrl, "_blank", "noopener,noreferrer");
        toast.success("WhatsApp opened with message ready — hit send.");
        onClose();
        return;
      }
      if (r.stubbed) {
        toast.success(
          channel === "EMAIL"
            ? "Email logged (no RESEND_API_KEY — set one to actually send)."
            : "WhatsApp logged (stubbed).",
        );
      } else {
        toast.success(
          channel === "EMAIL" ? "Email reminder sent." : "WhatsApp reminder sent.",
        );
      }
      onClose();
    });
  };

  if (!open) return null;

  return (
    <div
      className="flex items-center justify-center px-4 py-8"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        backgroundColor: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl shadow-2xl"
        style={{
          zIndex: 100000,
          backgroundColor: "#ffffff",
          border: "1px solid rgba(0,0,0,0.12)",
          color: "#111111",
          minHeight: "200px",
        }}
      >
        <div className="flex items-center justify-between border-b border-subtle px-6 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Reminder preview · edit before sending
            </p>
            <h3 className="mt-1 text-[17px] font-semibold text-ink">
              {preview ? preview.partyName : "Loading…"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-3 transition-colors hover:bg-[var(--color-surface-3)] hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading || !preview ? (
          <div className="flex flex-1 items-center justify-center py-16 text-ink-3">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Building preview…
          </div>
        ) : (
          <>
            <div className="border-b border-subtle bg-neutral-50 dark:bg-neutral-800 px-6 py-3 text-[12px] text-ink-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Template:{" "}
                  <span className="font-medium text-ink-2">
                    {TEMPLATE_LABEL[preview.template]}
                  </span>
                </span>
                <span>•</span>
                <span>
                  {preview.daysOverdue <= 0
                    ? `${Math.abs(preview.daysOverdue)} days until due`
                    : `${preview.daysOverdue} days overdue`}
                </span>
                {(subjectEdited || bodyEdited || whatsappEdited) && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-amber-700">Edited</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex border-b border-subtle">
              <TabButton
                active={tab === "email"}
                onClick={() => setTab("email")}
                icon={<Mail className="h-3.5 w-3.5" />}
                label="Email"
                sub={preview.email.to ?? "no email on file"}
              />
              <TabButton
                active={tab === "whatsapp"}
                onClick={() => setTab("whatsapp")}
                icon={<MessageCircle className="h-3.5 w-3.5" />}
                label="WhatsApp"
                sub={preview.whatsapp.to ?? "no number on file"}
              />
            </div>

            <div className="flex-1 overflow-auto">
              {tab === "email" ? (
                <div className="p-6 space-y-4">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                      To
                    </label>
                    <div className="mt-1 rounded-lg border border-subtle bg-neutral-50 dark:bg-neutral-800 px-3 py-2 font-mono text-[13px] text-ink-2">
                      {preview.email.to ?? (
                        <span className="italic text-ink-3">
                          no email on file for this debtor
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-subtle bg-white px-3 py-2 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-[rgba(0,113,227,0.2)]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                      Body (plain text — formatting auto-applied on send)
                    </label>
                    <textarea
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      rows={12}
                      className="mt-1 block w-full rounded-lg border border-subtle bg-white px-3 py-2 font-[inherit] text-[13.5px] leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-[rgba(0,113,227,0.2)]"
                    />
                  </div>
                  <details className="rounded-lg border border-subtle bg-neutral-50 dark:bg-neutral-800">
                    <summary className="cursor-pointer px-3 py-2 text-[12px] text-ink-3">
                      Preview rendered HTML (read-only)
                    </summary>
                    <iframe
                      title="Email preview"
                      srcDoc={preview.email.html}
                      className="h-[320px] w-full bg-white"
                      sandbox=""
                    />
                  </details>
                </div>
              ) : (
                <div className="p-6 space-y-4">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                      To
                    </label>
                    <div className="mt-1 rounded-lg border border-subtle bg-neutral-50 dark:bg-neutral-800 px-3 py-2 font-mono text-[13px] text-ink-2">
                      {preview.whatsapp.to ?? (
                        <span className="italic text-ink-3">
                          no phone/WhatsApp on file
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                      Message
                    </label>
                    <textarea
                      value={whatsappBody}
                      onChange={(e) => setWhatsappBody(e.target.value)}
                      rows={12}
                      className="mt-1 block w-full rounded-lg border border-subtle bg-white px-3 py-2 font-[inherit] text-[13.5px] leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-[rgba(0,113,227,0.2)]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between border-t border-subtle bg-neutral-50 dark:bg-neutral-800 px-6 py-3">
              <button
                type="button"
                onClick={onClose}
                className="text-[13px] text-ink-3 transition-colors hover:text-ink"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!preview.email.to || sending}
                  onClick={() => dispatch("EMAIL")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-white px-4 py-2 text-[13px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mail className="h-3.5 w-3.5" />
                  )}
                  Send email
                </button>
                <button
                  type="button"
                  disabled={!preview.whatsapp.to || sending}
                  onClick={() => dispatch("WHATSAPP")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-blue,#0071e3)] px-4 py-2 text-[13px] font-medium text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send WhatsApp
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center gap-2 px-6 py-3 text-left text-[13px] transition-colors ${
        active
          ? "border-b-2 border-ink bg-white text-ink dark:bg-neutral-900"
          : "border-b-2 border-transparent text-ink-3 hover:text-ink-2"
      }`}
    >
      {icon}
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-[11px] text-ink-3">{sub}</div>
      </div>
    </button>
  );
}
