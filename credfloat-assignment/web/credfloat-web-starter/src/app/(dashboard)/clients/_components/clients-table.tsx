"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  Bookmark,
  BookmarkPlus,
  ChevronRight,
  Download,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { downloadCSV, toCSV } from "@/lib/csv";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setClientStatus } from "../_actions/set-status";
import { bulkSetClientStatus } from "../_actions/bulk";
import { saveView, deleteView } from "../_actions/saved-views";
import { Sparkline } from "./sparkline";
import { GradePill } from "@/components/ui/grade-pill";
import type { Grade } from "@/lib/scoring";

type Row = {
  id: string;
  name: string;
  status: string;
  outstanding: number;
  overdue: number;
  debtorCount: number;
  lastSynced: string;
  outstandingFormatted: string;
  overdueFormatted: string | null;
  sparkline: number[];
  grade: Grade | null;
  gradeTooltip: string;
};

type SavedView = { id: string; name: string; params: string };

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
] as const;

export function ClientsTable({
  rows,
  initialQuery,
  initialStatus,
  savedViews,
}: {
  rows: Row[];
  initialQuery: string;
  initialStatus: string;
  savedViews: SavedView[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  const hasActiveFilters = !!initialQuery || initialStatus !== "all";

  const applyFilters = (q: string, status: string) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status && status !== "all") p.set("status", status);
    startTransition(() => {
      router.push(`/clients?${p.toString()}`);
    });
  };

  // J/K keyboard nav over rows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)
        return;
      if (rows.length === 0) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((i) => (i === null ? 0 : Math.min(rows.length - 1, i + 1)));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => (i === null ? 0 : Math.max(0, i - 1)));
      } else if (e.key === "Enter" && focusIndex !== null) {
        e.preventDefault();
        router.push(`/clients/${rows[focusIndex].id}`);
      } else if (e.key === " " && focusIndex !== null) {
        e.preventDefault();
        const row = rows[focusIndex];
        setSelected((prev) => {
          const n = new Set(prev);
          n.has(row.id) ? n.delete(row.id) : n.add(row.id);
          return n;
        });
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setFocusIndex(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, focusIndex, router]);

  const onExport = () => {
    if (rows.length === 0) {
      toast.info("Nothing to export — list is empty.");
      return;
    }
    const csv = toCSV(
      rows.map((r) => ({
        name: r.name,
        status: r.status,
        outstanding_inr: r.outstanding,
        overdue_60plus_inr: r.overdue,
        debtor_count: r.debtorCount,
        last_synced: r.lastSynced,
      })),
      [
        { key: "name", header: "Client" },
        { key: "status", header: "Status" },
        { key: "outstanding_inr", header: "Outstanding (INR)" },
        { key: "overdue_60plus_inr", header: "Overdue 60+ (INR)" },
        { key: "debtor_count", header: "Debtors" },
        { key: "last_synced", header: "Last synced" },
      ],
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`ledger-clients-${stamp}.csv`, csv);
    toast.success(`Exported ${rows.length} client${rows.length === 1 ? "" : "s"}`);
  };

  const onPause = (id: string, next: "ACTIVE" | "PAUSED") => {
    startTransition(async () => {
      const res = await setClientStatus(id, next);
      if (res.ok) {
        toast.success(next === "PAUSED" ? "Reminders paused" : "Reminders resumed");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const onBulk = (status: "ACTIVE" | "PAUSED" | "ARCHIVED") => {
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await bulkSetClientStatus({ ids, status });
      if (res.ok) {
        toast.success(
          `${status === "ACTIVE" ? "Resumed" : status === "PAUSED" ? "Paused" : "Archived"} ${res.updated} client${res.updated === 1 ? "" : "s"}`,
        );
        setSelected(new Set());
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const onSaveView = () => {
    const name = window.prompt(
      "Name this view (e.g. 'My worst debtors'):",
      "Custom view",
    );
    if (!name) return;
    const params = searchParams.toString();
    startTransition(async () => {
      const res = await saveView({ name, path: "/clients", params });
      if (res.ok) {
        toast.success(`Saved '${name}'`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const onDeleteView = (id: string, name: string) => {
    if (!confirm(`Remove saved view '${name}'?`)) return;
    startTransition(async () => {
      const res = await deleteView(id);
      if (res.ok) {
        toast.success("Saved view removed");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  const allChecked =
    rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-5">
      {/* Saved views strip */}
      {(savedViews.length > 0 || hasActiveFilters) && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink-3">Saved views:</span>
          {savedViews.length === 0 && (
            <span className="text-ink-3/70">None yet</span>
          )}
          {savedViews.map((v) => {
            const active =
              searchParams.toString() === v.params ||
              (!searchParams.toString() && !v.params);
            return (
              <span
                key={v.id}
                className={`group inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12.5px] transition-all ${
                  active
                    ? "border-[var(--color-accent-blue)] bg-[rgba(0,113,227,0.08)] text-[var(--color-accent-blue)]"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-ink-2 hover:border-[var(--color-border-hair)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => router.push(`/clients?${v.params}`)}
                  className="inline-flex items-center gap-1 font-medium"
                >
                  <Bookmark className="h-3 w-3" />
                  {v.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteView(v.id, v.name)}
                  className="ml-1 text-ink-3 opacity-0 transition-opacity hover:text-[#c6373a] group-hover:opacity-100"
                  aria-label={`Remove ${v.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onSaveView}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-border-hair)] bg-transparent px-3 py-1 text-[12.5px] text-ink-3 transition-colors hover:border-[var(--color-accent-blue)] hover:text-[var(--color-accent-blue)]"
            >
              <BookmarkPlus className="h-3 w-3" />
              Save current filters
            </button>
          )}
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters(query, initialStatus);
            }}
            placeholder="Search clients by name…"
            className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] pl-9 pr-3 text-[14.5px] text-ink outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
          />
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] p-1 text-[12.5px]">
          {STATUS_OPTIONS.map((opt) => {
            const active = initialStatus === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => applyFilters(query, opt.value)}
                className={`rounded-lg px-3 py-1.5 font-medium transition-all ${
                  active
                    ? "bg-[var(--color-surface-2)] text-ink shadow-[var(--shadow-apple-sm)]"
                    : "text-ink-3 hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onExport}
          className="btn-apple-ghost h-10 gap-1.5 px-3 text-[14px]"
          aria-label="Export as CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
      </div>

      {/* Bulk-action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-[var(--color-accent-blue)] bg-[rgba(0,113,227,0.04)] px-4 py-2.5">
          <div className="text-[13.5px] text-ink-2">
            <span className="font-semibold text-ink">{selected.size}</span>{" "}
            selected
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onBulk("PAUSED")}
              disabled={pending}
              className="btn-apple-ghost h-8 gap-1 px-3 text-[12.5px]"
            >
              <Pause className="h-3 w-3" />
              Pause
            </button>
            <button
              type="button"
              onClick={() => onBulk("ACTIVE")}
              disabled={pending}
              className="btn-apple-ghost h-8 gap-1 px-3 text-[12.5px]"
            >
              <Play className="h-3 w-3" />
              Resume
            </button>
            <button
              type="button"
              onClick={() => onBulk("ARCHIVED")}
              disabled={pending}
              className="btn-apple-ghost h-8 gap-1 px-3 text-[12.5px]"
            >
              <Archive className="h-3 w-3" />
              Archive
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-[var(--color-surface-2)] hover:text-ink"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div
        className="card-apple overflow-hidden transition-opacity"
        style={{ opacity: pending ? 0.6 : 1 }}
      >
        {rows.length === 0 ? (
          <EmptyState hasFilters={hasActiveFilters} />
        ) : (
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                <th className="w-10 px-5 py-4">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    aria-label="Select all"
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(rows.map((r) => r.id))
                          : new Set(),
                      )
                    }
                    className="h-4 w-4 cursor-pointer rounded border-[var(--color-border-hair)]"
                  />
                </th>
                <th className="px-4 py-4 text-left font-medium">Client</th>
                <th className="px-8 py-4 text-right font-medium">Outstanding</th>
                <th className="px-8 py-4 text-right font-medium">Overdue 60+</th>
                <th className="px-8 py-4 text-right font-medium">Debtors</th>
                <th className="px-4 py-4 text-center font-medium">Grade</th>
                <th className="px-6 py-4 text-left font-medium">6-mo collections</th>
                <th className="px-8 py-4 text-left font-medium">Status</th>
                <th className="px-8 py-4 text-left font-medium">Last synced</th>
                <th className="w-10 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const checked = selected.has(c.id);
                const isFocused = focusIndex === i;
                return (
                  <tr
                    key={c.id}
                    className={`group border-t border-subtle transition-colors ${
                      isFocused
                        ? "bg-[rgba(0,113,227,0.06)]"
                        : "hover:bg-[var(--color-surface-2)]/60"
                    } ${checked ? "bg-[rgba(0,113,227,0.04)]" : ""}`}
                  >
                    <td className="w-10 px-5 py-5">
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`Select ${c.name}`}
                        onChange={() =>
                          setSelected((prev) => {
                            const n = new Set(prev);
                            n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                            return n;
                          })
                        }
                        className="h-4 w-4 cursor-pointer rounded border-[var(--color-border-hair)]"
                      />
                    </td>
                    <td className="px-4 py-5">
                      <Link
                        href={`/clients/${c.id}`}
                        className="font-medium text-ink hover:text-[var(--color-accent-blue)]"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="tabular px-8 py-5 text-right font-medium text-ink">
                      {c.outstandingFormatted}
                    </td>
                    <td className="tabular px-8 py-5 text-right">
                      {c.overdueFormatted ? (
                        <span
                          className="font-medium"
                          style={{ color: "#c6373a" }}
                        >
                          {c.overdueFormatted}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="tabular px-8 py-5 text-right text-ink-2">
                      {c.debtorCount}
                    </td>
                    <td className="px-4 py-5 text-center">
                      <GradePill grade={c.grade} tooltip={c.gradeTooltip} />
                    </td>
                    <td className="px-6 py-5">
                      <Sparkline data={c.sparkline} />
                    </td>
                    <td className="px-8 py-5">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-8 py-5 text-ink-3">{c.lastSynced}</td>
                    <td className="px-2 py-5">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 opacity-0 transition-all hover:bg-[var(--color-surface-2)] hover:text-ink group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label="Row actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => router.push(`/clients/${c.id}`)}
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                            View detail
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              router.push(`/clients/${c.id}/reminders`)
                            }
                          >
                            <Play className="h-3.5 w-3.5" />
                            Reminder settings
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {c.status === "ACTIVE" ? (
                            <DropdownMenuItem
                              onSelect={() => onPause(c.id, "PAUSED")}
                            >
                              <Pause className="h-3.5 w-3.5" />
                              Pause reminders
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => onPause(c.id, "ACTIVE")}
                            >
                              <Play className="h-3.5 w-3.5" />
                              Resume reminders
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-center text-[11.5px] text-ink-3">
        Tip: <kbd className="rounded bg-[var(--color-surface-2)] px-1 font-mono">J</kbd>/<kbd className="rounded bg-[var(--color-surface-2)] px-1 font-mono">K</kbd> to navigate, <kbd className="rounded bg-[var(--color-surface-2)] px-1 font-mono">Space</kbd> to select, <kbd className="rounded bg-[var(--color-surface-2)] px-1 font-mono">Enter</kbd> to open.
      </p>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="px-8 py-20 text-center">
      <p className="text-[15px] text-ink-2">
        {hasFilters ? "No clients match those filters." : "No client companies yet."}
      </p>
      <p className="mt-1 text-[13px] text-ink-3">
        {hasFilters
          ? "Try broadening the search or switching to All."
          : "Run the Tally connector to sync data."}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; dot: string }> = {
    ACTIVE: {
      bg: "rgba(48,209,88,0.14)",
      color: "#1f7a4a",
      dot: "#30d158",
    },
    PAUSED: {
      bg: "rgba(255,159,10,0.14)",
      color: "#9c5700",
      dot: "#ff9f0a",
    },
    ARCHIVED: {
      bg: "rgba(134,134,139,0.14)",
      color: "var(--color-ink-2)",
      dot: "var(--color-ink-3)",
    },
  };
  const s = styles[status] ?? styles.ARCHIVED;
  return (
    <span className="pill" style={{ background: s.bg, color: s.color }}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: s.dot }}
      />
      {status.toLowerCase()}
    </span>
  );
}
