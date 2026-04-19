"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Send, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  updateReminderRule,
  sendTestReminder,
} from "../_actions/update-rule";

type Channel = "EMAIL" | "SMS" | "WHATSAPP";

const CHANNEL_LABEL: Record<Channel, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

const CHANNEL_HINT: Record<Channel, string> = {
  EMAIL: "Sent via Resend when the API key is present, stub logged otherwise.",
  SMS: "DLT templates still pending registration. Currently logs to console.",
  WHATSAPP: "Meta Cloud API; requires phone-number id + access token.",
};

export function ReminderForm({
  clientId,
  clientName,
  initial,
}: {
  clientId: string;
  clientName: string;
  initial: {
    enabled: boolean;
    triggerDays: number[];
    channels: Channel[];
    emailTemplate: string;
    smsTemplate: string;
    whatsappTemplateId: string;
  };
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [triggerDays, setTriggerDays] = useState<number[]>(initial.triggerDays);
  const [triggerInput, setTriggerInput] = useState("");
  const [channels, setChannels] = useState<Channel[]>(initial.channels);
  const [emailTemplate, setEmailTemplate] = useState(initial.emailTemplate);
  const [smsTemplate, setSmsTemplate] = useState(initial.smsTemplate);
  const [whatsappTemplateId, setWhatsappTemplateId] = useState(
    initial.whatsappTemplateId,
  );
  const [testChannel, setTestChannel] = useState<Channel>("EMAIL");
  const [testTo, setTestTo] = useState("");
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  const toggleChannel = (c: Channel) => {
    setChannels((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  };

  const addTriggerDay = () => {
    const n = parseInt(triggerInput, 10);
    if (Number.isNaN(n)) {
      toast.error("Trigger day must be a number");
      return;
    }
    if (triggerDays.includes(n)) {
      toast.info(`${n} is already in the list`);
      setTriggerInput("");
      return;
    }
    setTriggerDays([...triggerDays, n].sort((a, b) => a - b));
    setTriggerInput("");
  };

  const removeTriggerDay = (n: number) => {
    setTriggerDays(triggerDays.filter((x) => x !== n));
  };

  const onSave = () => {
    startSave(async () => {
      const res = await updateReminderRule({
        clientId,
        enabled,
        triggerDays,
        channels,
        emailTemplate: emailTemplate || null,
        smsTemplate: smsTemplate || null,
        whatsappTemplateId: whatsappTemplateId || null,
      });
      if (res.ok) toast.success("Reminder rule saved");
      else toast.error(res.error);
    });
  };

  const onTest = () => {
    if (!testTo.trim()) {
      toast.error("Enter a destination (email, mobile, or phone)");
      return;
    }
    startTest(async () => {
      const res = await sendTestReminder({
        clientId,
        channel: testChannel,
        to: testTo.trim(),
      });
      if (res.ok) {
        toast.success(
          `Sent via ${CHANNEL_LABEL[testChannel]}`,
          { description: `Provider reference: ${res.providerId}` },
        );
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Enable */}
      <section className="card-apple p-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Status
            </p>
            <h2 className="mt-2 text-[20px] font-semibold text-ink">
              Automated reminders for {clientName}
            </h2>
            <p className="mt-1 max-w-xl text-[14.5px] leading-relaxed text-ink-3">
              When enabled, Ledger dispatches reminders for this client&apos;s
              open invoices each morning at 10:00 IST. Disable to pause
              everything without losing settings.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </section>

      {/* Trigger days */}
      <section className="card-apple p-8">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Trigger days
          </p>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">
            When to fire
          </h2>
          <p className="mt-1 max-w-xl text-[14.5px] leading-relaxed text-ink-3">
            Offsets relative to each invoice&apos;s due date. Negative values
            fire before due date (e.g. <span className="tabular">-3</span> is
            three days before). Zero is due-day.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {triggerDays.map((n) => (
            <span
              key={n}
              className="tabular inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] py-1 pl-3 pr-1.5 text-[14px] font-medium text-ink"
            >
              {n > 0 ? `+${n}` : n}
              <button
                type="button"
                onClick={() => removeTriggerDay(n)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-[var(--color-surface-3)] hover:text-ink"
                aria-label={`Remove ${n}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={triggerInput}
            onChange={(e) => setTriggerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTriggerDay();
              }
            }}
            placeholder="Add day… (e.g. -3, 7)"
            className="tabular h-9 w-40 rounded-full border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[14px] outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
          />
        </div>
      </section>

      {/* Channels */}
      <section className="card-apple p-8">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Channels
          </p>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">
            Where reminders go
          </h2>
          <p className="mt-1 text-[14.5px] text-ink-3">
            Each debtor gets contacted on every enabled channel they have
            populated in Tally.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(["EMAIL", "WHATSAPP", "SMS"] as Channel[]).map((c) => {
            const active = channels.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleChannel(c)}
                className={`rounded-2xl border p-4 text-left transition-all ${
                  active
                    ? "border-[var(--color-accent-blue)] bg-[rgba(0,113,227,0.04)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] hover:border-[var(--color-border-hair)]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[15px] font-semibold text-ink">
                    {CHANNEL_LABEL[c]}
                  </div>
                  <div
                    className={`h-4 w-4 rounded-full border transition-colors ${
                      active
                        ? "border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]"
                        : "border-[var(--color-border-hair)]"
                    }`}
                    aria-hidden
                  >
                    {active && (
                      <svg viewBox="0 0 16 16" className="h-full w-full text-white">
                        <path
                          d="M4 8l3 3 5-6"
                          stroke="currentColor"
                          strokeWidth="2"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
                  {CHANNEL_HINT[c]}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Templates */}
      <section className="card-apple p-8 space-y-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Templates
          </p>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">
            Message copy
          </h2>
          <p className="mt-1 max-w-2xl text-[14.5px] text-ink-3">
            Variables:{" "}
            <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11.5px]">
              {"{{party_name}}"}
            </code>
            ,{" "}
            <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11.5px]">
              {"{{amount}}"}
            </code>
            ,{" "}
            <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11.5px]">
              {"{{bill_ref}}"}
            </code>
            ,{" "}
            <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11.5px]">
              {"{{days_overdue}}"}
            </code>
            . Leave blank to use the built-in gentle/follow-up/final cascade.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email-template" className="text-[14px] font-medium text-ink-2">
            Email body override
          </Label>
          <Textarea
            id="email-template"
            value={emailTemplate}
            onChange={(e) => setEmailTemplate(e.target.value)}
            rows={5}
            placeholder="Leave blank for default templates."
            className="font-mono text-[14px]"
          />
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="sms-template" className="text-[14px] font-medium text-ink-2">
              SMS body · 160 char limit
            </Label>
            <Textarea
              id="sms-template"
              value={smsTemplate}
              onChange={(e) => setSmsTemplate(e.target.value.slice(0, 160))}
              rows={3}
              placeholder="Short DLT-approved body."
              className="font-mono text-[14px]"
            />
            <div className="tabular text-right text-[11px] text-ink-3">
              {smsTemplate.length}/160
            </div>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="whatsapp-template-id"
              className="text-[14px] font-medium text-ink-2"
            >
              WhatsApp template ID
            </Label>
            <input
              id="whatsapp-template-id"
              value={whatsappTemplateId}
              onChange={(e) => setWhatsappTemplateId(e.target.value)}
              placeholder="payment_reminder"
              className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 font-mono text-[14px] outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
            />
            <p className="text-[11.5px] text-ink-3">
              Must exactly match a Meta-approved template in your Business
              Manager account.
            </p>
          </div>
        </div>
      </section>

      {/* Send test */}
      <section className="card-apple p-8">
        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Validate
          </p>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">
            Send a test reminder
          </h2>
          <p className="mt-1 text-[14.5px] text-ink-3">
            Dispatches a sample payload to the address you provide. Does not
            write to{" "}
            <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11.5px]">
              ReminderSent
            </code>
            .
          </p>
        </div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] p-1 text-[14px]">
            {(["EMAIL", "WHATSAPP", "SMS"] as Channel[]).map((c) => {
              const active = testChannel === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setTestChannel(c)}
                  className={`rounded-lg px-3 py-1.5 font-medium transition-all ${
                    active
                      ? "bg-[var(--color-surface-2)] text-ink shadow-[var(--shadow-apple-sm)]"
                      : "text-ink-3 hover:text-ink"
                  }`}
                >
                  {CHANNEL_LABEL[c]}
                </button>
              );
            })}
          </div>
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder={
              testChannel === "EMAIL"
                ? "you@example.com"
                : "+91 98XXXXXXXX"
            }
            className="h-10 flex-1 rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] px-3.5 text-[14px] outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
          />
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="btn-apple h-10 gap-1.5 px-4 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {testing ? "Sending…" : "Send test"}
          </button>
        </div>
      </section>

      {/* Save sticky */}
      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)]/90 p-4 shadow-[var(--shadow-apple-md)] backdrop-blur">
        <div className="text-[12.5px] text-ink-3">
          Changes apply to the next daily cron run at 10:00 IST.
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="btn-apple h-10 px-5 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save configuration"}
        </button>
      </div>
    </div>
  );
}
