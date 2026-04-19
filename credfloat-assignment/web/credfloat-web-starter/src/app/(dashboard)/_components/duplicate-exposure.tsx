"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Users2 } from "lucide-react";
import type { DupGroup } from "@/lib/duplicates";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function DuplicateExposure({ groups }: { groups: DupGroup[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (groups.length === 0) return null;

  const totalCrossExposure = groups.reduce((s, g) => s + g.totalExposure, 0);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  return (
    <section className="card-apple overflow-hidden">
      <div className="flex items-end justify-between gap-4 px-10 pt-9 pb-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            Cross-client exposure
          </p>
          <h2 className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
            Likely same legal entity across {groups.length} client
            {groups.length === 1 ? "" : "s"}
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-ink-3">
            Ledgers with matching normalized names are grouped here. Gives you
            consolidated exposure to an entity that appears in multiple of the
            firm&apos;s clients&apos; books.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-3">
            Total pooled
          </div>
          <div className="tabular mt-0.5 text-[18px] font-semibold text-ink">
            {inr(totalCrossExposure)}
          </div>
        </div>
      </div>

      <div className="border-t border-subtle">
        {groups.map((g, i) => {
          const isOpen = expanded.has(g.key);
          return (
            <div
              key={g.key}
              className={i > 0 ? "border-t border-subtle" : undefined}
            >
              <button
                type="button"
                onClick={() => toggle(g.key)}
                className="flex w-full items-center gap-5 px-10 py-4 text-left transition-colors hover:bg-[var(--color-surface-2)]/60"
              >
                <div
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, #5e5ce6, #bf5af2)",
                  }}
                >
                  <Users2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="text-[15px] font-medium text-ink">
                      {g.displayName}
                    </div>
                    <div className="tabular text-[15px] font-semibold text-ink">
                      {inr(g.totalExposure)}
                    </div>
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-3">
                    Across{" "}
                    <span className="font-medium">{g.clientCount} clients</span>{" "}
                    · {g.parties.length} debtor ledger
                    {g.parties.length === 1 ? "" : "s"}
                  </div>
                </div>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />
                )}
              </button>
              {isOpen && (
                <div className="border-t border-subtle bg-[var(--color-surface-2)]/40 px-10 py-3">
                  <ul className="space-y-1.5 text-[13.5px]">
                    {g.parties.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-baseline justify-between gap-4"
                      >
                        <span className="text-ink-2">
                          <Link
                            href={`/clients/${p.clientCompanyId}`}
                            className="font-medium text-[var(--color-accent-blue)] hover:underline"
                          >
                            {p.clientCompanyName}
                          </Link>{" "}
                          <span className="text-ink-3">·</span>{" "}
                          {p.mailingName || p.tallyLedgerName}
                        </span>
                        <span className="tabular text-ink">
                          {inr(p.closingBalance)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
