"use client";

import { useState, useTransition } from "react";
import { Upload, FileDown, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  previewContactImport,
  commitContactImport,
  getContactImportTemplate,
  type PreviewRow,
} from "../_actions/contacts-import";

/**
 * Excel-import modal. Uploads a spreadsheet, shows a dry-run preview
 * with per-cell status (set / overwrite / skip / unchanged), and lets
 * staff commit only after they've seen exactly what will change.
 */
export function ContactsImportButton({
  clientCompanyId,
}: {
  clientCompanyId: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startPending] = useTransition();
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    summary: {
      totalRows: number;
      matched: number;
      unmatched: number;
      willUpdate: number;
      willOverwrite: number;
    };
  } | null>(null);

  const onFile = async (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setFileBase64(result);
      setFileName(f.name);
      setPreview(null);
    };
    reader.readAsDataURL(f);
  };

  const runPreview = () => {
    if (!fileBase64) return;
    startPending(async () => {
      const r = await previewContactImport({
        clientCompanyId,
        fileBase64,
        overwrite,
      });
      if (!("rows" in r)) {
        toast.error(r.error);
        return;
      }
      setPreview(r);
    });
  };

  const commit = () => {
    if (!fileBase64 || !preview) return;
    startPending(async () => {
      const r = await commitContactImport({
        clientCompanyId,
        fileBase64,
        overwrite,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Updated ${r.updated} debtor${r.updated === 1 ? "" : "s"}` +
          (r.overwritten > 0 ? ` (${r.overwritten} overwrites)` : "") +
          (r.unmatched > 0 ? ` · ${r.unmatched} unmatched` : ""),
      );
      setOpen(false);
      setFileBase64(null);
      setFileName("");
      setPreview(null);
    });
  };

  const downloadTemplate = async () => {
    const dataUrl = await getContactImportTemplate();
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "dps_ledger_contacts_template.xlsx";
    a.click();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-1.5 text-[12.5px] font-medium text-ink-2 transition-all hover:border-[var(--color-border-hair)] hover:text-ink"
      >
        <Upload className="h-3.5 w-3.5" />
        Import contacts
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-6 pt-10"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-[var(--color-surface-3)] shadow-[var(--shadow-apple-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-subtle px-6 py-5">
              <div>
                <h3 className="text-[18px] font-semibold tracking-tight text-ink">
                  Import contacts from Excel
                </h3>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  Fill emails / phones / WhatsApp for debtors in bulk.
                  Matched by ledger name. Debtors come from Tally — we
                  only update contact fields, never create new rows.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-1.5 -mt-1.5 rounded-md p-1 text-ink-3 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {!preview && (
                <>
                  <div className="rounded-xl border border-dashed border-[var(--color-border-hair)] bg-[var(--color-surface-2)] px-5 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-[13px] text-ink-2">
                        Need a starting point?
                      </div>
                      <button
                        type="button"
                        onClick={downloadTemplate}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-3 py-1 text-[12px] font-medium text-ink-2 hover:border-[var(--color-border-hair)]"
                      >
                        <FileDown className="h-3 w-3" />
                        Download template
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[13px] font-medium text-ink-2">
                      Spreadsheet (.xlsx or .csv)
                    </label>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                      onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                      className="block w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[13.5px] text-ink-2 file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-surface-3)] file:px-3 file:py-1.5 file:text-[12px] file:font-medium"
                    />
                    {fileName && (
                      <p className="text-[11.5px] text-ink-3">
                        Selected: <span className="text-ink-2">{fileName}</span>
                      </p>
                    )}
                  </div>

                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    Overwrite existing values (default: skip and keep what&apos;s
                    already there)
                  </label>

                  <div className="flex justify-end gap-2 border-t border-subtle pt-4">
                    <button
                      type="button"
                      onClick={runPreview}
                      disabled={!fileBase64 || pending}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                      style={{ background: "var(--color-accent-blue)" }}
                    >
                      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Preview changes
                    </button>
                  </div>
                </>
              )}

              {preview && (
                <>
                  <div className="grid grid-cols-5 gap-3">
                    <StatBox label="Rows" value={preview.summary.totalRows} />
                    <StatBox label="Matched" value={preview.summary.matched} />
                    <StatBox
                      label="Unmatched"
                      value={preview.summary.unmatched}
                      tone="warn"
                    />
                    <StatBox
                      label="Will update"
                      value={preview.summary.willUpdate}
                      tone="good"
                    />
                    <StatBox
                      label="Overwrites"
                      value={preview.summary.willOverwrite}
                      tone={overwrite ? "good" : "warn"}
                    />
                  </div>

                  <div className="max-h-80 overflow-y-auto rounded-xl border border-subtle">
                    <table className="w-full text-[12.5px]">
                      <thead className="sticky top-0 bg-[var(--color-surface-2)] text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">
                            Ledger name
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Email
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Phone
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            WhatsApp
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r, i) => (
                          <tr
                            key={i}
                            className={`border-t border-subtle ${r.status === "unmatched" ? "bg-amber-50/40" : ""}`}
                          >
                            <td className="px-3 py-2 font-medium text-ink">
                              {r.ledgerName}
                              {r.status === "unmatched" && (
                                <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700">
                                  not found
                                </span>
                              )}
                            </td>
                            <Cell
                              incoming={r.email}
                              existing={r.existing?.email ?? null}
                              change={r.wouldChange.email}
                            />
                            <Cell
                              incoming={r.phone}
                              existing={r.existing?.phone ?? null}
                              change={r.wouldChange.phone}
                            />
                            <Cell
                              incoming={r.whatsapp}
                              existing={r.existing?.whatsapp ?? null}
                              change={r.wouldChange.whatsapp}
                            />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end gap-2 border-t border-subtle pt-4">
                    <button
                      type="button"
                      onClick={() => setPreview(null)}
                      className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] px-4 py-2 text-[13px] font-medium text-ink-2"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={commit}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                      style={{ background: "var(--color-accent-blue)" }}
                    >
                      {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Apply {preview.summary.willUpdate} update
                      {preview.summary.willUpdate === 1 ? "" : "s"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatBox({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "warn";
}) {
  const color =
    tone === "good" ? "#1f7a4a" : tone === "warn" ? "#92400e" : "var(--color-ink)";
  return (
    <div className="rounded-xl border border-subtle bg-[var(--color-surface-2)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-3">
        {label}
      </div>
      <div
        className="tabular mt-1 text-[18px] font-semibold"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function Cell({
  incoming,
  existing,
  change,
}: {
  incoming: string | null;
  existing: string | null;
  change: "set" | "overwrite" | "skip" | "unchanged";
}) {
  if (change === "unchanged") {
    return (
      <td className="px-3 py-2 text-ink-3">
        {existing ?? <span className="text-ink-3/70">—</span>}
      </td>
    );
  }
  if (change === "set") {
    return (
      <td
        className="px-3 py-2 font-medium"
        style={{ color: "#1f7a4a" }}
      >
        {incoming}
      </td>
    );
  }
  if (change === "overwrite") {
    return (
      <td className="px-3 py-2">
        <div className="font-medium" style={{ color: "#0057b7" }}>
          {incoming}
        </div>
        <div className="text-[10.5px] text-ink-3 line-through">{existing}</div>
      </td>
    );
  }
  // skip
  return (
    <td className="px-3 py-2">
      <div className="text-ink-3 line-through text-[11px]">{incoming}</div>
      <div className="text-ink-2 text-[11px]">{existing} (kept)</div>
    </td>
  );
}
