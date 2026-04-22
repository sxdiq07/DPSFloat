"use client";

import { useTransition } from "react";
import { Archive, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { archiveParty } from "../_actions/bulk-debtor";

/**
 * Soft-archive button for a single debtor. Confirms, calls the
 * server action, and lets the route re-render. Only archives — the
 * unarchive path is reserved for a future "show archived" filter.
 */
export function ArchiveDebtorButton({
  partyId,
  partyName,
}: {
  partyId: string;
  partyName: string;
}) {
  const [pending, startPending] = useTransition();

  const onClick = () => {
    if (
      !confirm(
        `Archive ${partyName}? They'll disappear from every list and reminders will stop. ` +
          `You can unarchive later if needed.`,
      )
    )
      return;
    startPending(async () => {
      const r = await archiveParty({ partyId, archive: true });
      if (!r.ok) toast.error(r.error);
      else toast.success(`${partyName} archived`);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Archive this debtor (soft-delete)"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-3 transition-all hover:border-amber-300 hover:text-amber-700 disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Archive className="h-3 w-3" />
      )}
    </button>
  );
}
