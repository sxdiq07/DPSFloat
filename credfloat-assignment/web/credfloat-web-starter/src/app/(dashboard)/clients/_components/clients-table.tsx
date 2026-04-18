"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, MoreHorizontal, Pause, Play, Search } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setClientStatus } from "../_actions/set-status";

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
};

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
}: {
  rows: Row[];
  initialQuery: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();

  const applyFilters = (q: string, status: string) => {
    const p = new URLSearchParams(searchParams.toString());
    if (q) p.set("q", q);
    else p.delete("q");
    if (status && status !== "all") p.set("status", status);
    else p.delete("status");
    startTransition(() => {
      router.push(`/clients?${p.toString()}`);
    });
  };

  const onPause = (id: string, next: "ACTIVE" | "PAUSED") => {
    startTransition(async () => {
      const res = await setClientStatus(id, next);
      if (res.ok) {
        toast.success(
          next === "PAUSED" ? "Reminders paused" : "Reminders resumed",
        );
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-5">
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
            className="h-10 w-full rounded-xl border border-[var(--color-border-hair)] bg-[var(--color-surface-3)] pl-9 pr-3 text-[13.5px] text-ink outline-none transition-all placeholder:text-ink-3 focus:border-[var(--color-accent-blue)] focus:ring-4 focus:ring-[rgba(0,113,227,0.12)]"
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
      </div>

      <div
        className="card-apple overflow-hidden transition-opacity"
        style={{ opacity: pending ? 0.6 : 1 }}
      >
        {rows.length === 0 ? (
          <EmptyState hasFilters={!!initialQuery || initialStatus !== "all"} />
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
                <th className="px-8 py-4 text-left font-medium">Client</th>
                <th className="px-8 py-4 text-right font-medium">
                  Outstanding
                </th>
                <th className="px-8 py-4 text-right font-medium">Overdue 60+</th>
                <th className="px-8 py-4 text-right font-medium">Debtors</th>
                <th className="px-8 py-4 text-left font-medium">Status</th>
                <th className="px-8 py-4 text-left font-medium">Last synced</th>
                <th className="w-10 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr
                  key={c.id}
                  className={`row-interactive group ${i > 0 ? "border-t border-subtle" : "border-t border-subtle"}`}
                >
                  <td className="px-8 py-5">
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
                        <DropdownMenuItem asChild>
                          <Link href={`/clients/${c.id}`}>
                            <ChevronRight className="h-3.5 w-3.5" />
                            View detail
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/clients/${c.id}/reminders`}>
                            <Play className="h-3.5 w-3.5" />
                            Reminder settings
                          </Link>
                        </DropdownMenuItem>
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
              ))}
            </tbody>
          </table>
        )}
      </div>
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
