"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { FileDown, Loader2 } from "lucide-react";
import { getLedgerDownloadUrl } from "../_actions/ledger";

export function DownloadLedgerButton({ partyId }: { partyId: string }) {
  const [pending, startPending] = useTransition();

  const onClick = () => {
    startPending(async () => {
      const r = await getLedgerDownloadUrl({ partyId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Download ledger PDF (48h signed link)"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-3 transition-all hover:border-[var(--color-border-hair)] hover:text-ink disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <FileDown className="h-3 w-3" />
      )}
    </button>
  );
}
