"use client";

import { useTransition } from "react";
import { PhoneCall, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { initiateIvrCall } from "../_actions/ivr";

/**
 * Trigger a Twilio Studio IVR call for this debtor. Confirms once,
 * fires the server action, toasts the outcome, and relies on route
 * revalidation to surface the new CallLog in the reminder log tab.
 */
export function IvrCallButton({
  partyId,
  partyName,
  invoiceId,
}: {
  partyId: string;
  partyName: string;
  invoiceId?: string;
}) {
  const [pending, startPending] = useTransition();

  const onClick = () => {
    if (
      !confirm(
        `Place an automated IVR call to ${partyName}?\n\n` +
          `Our Twilio Studio flow will dial the debtor, play the reminder ` +
          `script, and capture any key press. This is a real outbound call ` +
          `and will use Twilio credit.`,
      )
    )
      return;
    startPending(async () => {
      const r = await initiateIvrCall({
        partyId,
        invoiceId: invoiceId ?? null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Call queued — Twilio will dial ${partyName} shortly.`);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Place IVR call (Twilio)"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-3 transition-all hover:border-sky-300 hover:text-sky-700 disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <PhoneCall className="h-3 w-3" />
      )}
    </button>
  );
}
