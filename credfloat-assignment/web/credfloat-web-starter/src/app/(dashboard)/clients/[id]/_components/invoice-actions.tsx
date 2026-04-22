"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  setInvoiceDispute,
  markInvoicePaid,
} from "../_actions/invoice";

type Props = {
  invoiceId: string;
  currentStatus: "OPEN" | "PAID" | "DISPUTED";
};

/**
 * Tiny inline controls on each invoice row:
 *   - DISPUTE / UNDISPUTE toggle (pauses auto-reminders)
 *   - MARK PAID (manual reconciliation between Tally syncs)
 *
 * Rendered alongside the Send button.
 */
export function InvoiceActions({ invoiceId, currentStatus }: Props) {
  const [pending, startPending] = useTransition();

  const onToggleDispute = () => {
    const next = currentStatus !== "DISPUTED";
    const reason = next
      ? prompt("Dispute reason (optional — helps your audit trail):") ?? ""
      : "";
    startPending(async () => {
      const r = await setInvoiceDispute({
        invoiceId,
        disputed: next,
        reason: reason || null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        next ? "Marked as disputed — reminders paused" : "Dispute cleared",
      );
    });
  };

  const onMarkPaid = () => {
    if (
      !confirm(
        "Mark this invoice as fully paid? Next Tally sync may overwrite if Tally disagrees.",
      )
    )
      return;
    startPending(async () => {
      const r = await markInvoicePaid({ invoiceId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Marked paid");
    });
  };

  if (currentStatus === "PAID") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Paid
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={onToggleDispute}
        disabled={pending}
        title={
          currentStatus === "DISPUTED"
            ? "Clear dispute, resume reminders"
            : "Mark as disputed, pause reminders"
        }
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[10px] transition-all disabled:opacity-50 ${
          currentStatus === "DISPUTED"
            ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
            : "border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-3 hover:border-amber-300 hover:text-amber-700"
        }`}
      >
        {pending ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <AlertTriangle className="h-2.5 w-2.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onMarkPaid}
        disabled={pending}
        title="Mark as paid (manual)"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-3 transition-all hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-2.5 w-2.5" />
        )}
      </button>
    </div>
  );
}
