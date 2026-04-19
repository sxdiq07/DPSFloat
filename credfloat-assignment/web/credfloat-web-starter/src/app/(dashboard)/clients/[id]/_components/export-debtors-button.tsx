"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { downloadCSV, toCSV } from "@/lib/csv";

type DebtorRow = {
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  outstanding: number;
};

export function ExportDebtorsButton({
  clientName,
  rows,
}: {
  clientName: string;
  rows: DebtorRow[];
}) {
  const onClick = () => {
    if (rows.length === 0) {
      toast.info("Nothing to export — no debtors with outstanding.");
      return;
    }
    const csv = toCSV(
      rows.map((r) => ({
        name: r.name,
        email: r.email ?? "",
        whatsapp: r.whatsapp ?? "",
        phone: r.phone ?? "",
        address: (r.address ?? "").replace(/\r?\n/g, " · "),
        outstanding_inr: r.outstanding,
      })),
      [
        { key: "name", header: "Debtor" },
        { key: "email", header: "Email" },
        { key: "whatsapp", header: "WhatsApp" },
        { key: "phone", header: "Phone" },
        { key: "address", header: "Address" },
        { key: "outstanding_inr", header: "Outstanding (INR)" },
      ],
    );
    const slug = clientName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`${slug}-debtors-${stamp}.csv`, csv);
    toast.success(`Exported ${rows.length} debtor${rows.length === 1 ? "" : "s"}`);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
    >
      <Download className="h-3.5 w-3.5" />
      Export CSV
    </button>
  );
}
