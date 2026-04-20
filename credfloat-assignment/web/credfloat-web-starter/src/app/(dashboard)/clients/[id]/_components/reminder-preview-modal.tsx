"use client";

import { useEffect, useState } from "react";
import { X, Mail, MessageCircle, Loader2 } from "lucide-react";
import type { ReminderPreview } from "../_actions/preview-reminder";

type Props = {
  open: boolean;
  loading: boolean;
  preview: ReminderPreview | null;
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
  onClose,
}: Props) {
  const [tab, setTab] = useState<"email" | "whatsapp">("email");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 py-8 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-subtle px-6 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Reminder preview
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
            <div className="border-b border-subtle bg-[var(--color-surface-2)] px-6 py-3 text-[12px] text-ink-3">
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
                <div className="p-6">
                  <div className="mb-4 rounded-lg border border-subtle bg-[var(--color-surface-2)] px-4 py-3 text-[13px]">
                    <div className="flex gap-2">
                      <span className="text-ink-3">Subject:</span>
                      <span className="font-medium text-ink">
                        {preview.email.subject}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-2">
                      <span className="text-ink-3">To:</span>
                      <span className="font-mono text-ink-2">
                        {preview.email.to ?? (
                          <span className="italic text-ink-3">
                            no email on file for this debtor
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-subtle">
                    <iframe
                      title="Email preview"
                      srcDoc={preview.email.html}
                      className="h-[420px] w-full bg-white"
                      sandbox=""
                    />
                  </div>
                </div>
              ) : (
                <div className="p-6">
                  <div className="mb-4 rounded-lg border border-subtle bg-[var(--color-surface-2)] px-4 py-3 text-[13px]">
                    <div className="flex gap-2">
                      <span className="text-ink-3">To:</span>
                      <span className="font-mono text-ink-2">
                        {preview.whatsapp.to ?? (
                          <span className="italic text-ink-3">
                            no phone/WhatsApp on file
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-subtle bg-[var(--color-surface-2)] p-4 font-[inherit] text-[14px] leading-relaxed text-ink-2">
                    {preview.whatsapp.text}
                  </pre>
                  {preview.whatsapp.clickUrl && (
                    <a
                      href={preview.whatsapp.clickUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-4 py-2 text-[13px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Open in WhatsApp
                    </a>
                  )}
                </div>
              )}
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
          ? "border-b-2 border-ink bg-[var(--color-surface-1)] text-ink"
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
