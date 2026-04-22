"use client";

import { FileDown } from "lucide-react";

export type ExportableReminder = {
  sentAt: string;         // ISO
  debtor: string;
  billRef: string;
  channel: string;        // EMAIL / SMS / WHATSAPP
  status: string;         // SENT / DELIVERED / FAILED / BOUNCED / READ
  error?: string | null;
  providerId?: string | null;
};

/**
 * Client-side CSV exporter for the reminder log. No server round-trip
 * needed — rows are already in the page. Audit-friendly filename with
 * client + date.
 */
export function ExportRemindersButton({
  clientName,
  rows,
}: {
  clientName: string;
  rows: ExportableReminder[];
}) {
  const onClick = () => {
    if (rows.length === 0) return;
    const header = [
      "Sent at (IST)",
      "Debtor",
      "Invoice",
      "Channel",
      "Status",
      "Provider ref",
      "Error",
    ];
    const csv = [header, ...rows.map((r) => [
      r.sentAt,
      r.debtor,
      r.billRef,
      r.channel,
      r.status,
      r.providerId ?? "",
      (r.error ?? "").replace(/[\r\n]+/g, " ").slice(0, 500),
    ])]
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\r\n");

    const safeName = clientName.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}_reminder_log_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink disabled:opacity-50"
    >
      <FileDown className="h-3.5 w-3.5" />
      Export CSV
    </button>
  );
}
