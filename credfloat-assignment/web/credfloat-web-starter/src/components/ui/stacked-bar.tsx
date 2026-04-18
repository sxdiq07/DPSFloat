"use client";

import { useState } from "react";

export type StackedSegment = {
  key: string;
  label: string;
  value: number;
  gradient: string;
  solid: string;
};

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function StackedBar({ segments }: { segments: StackedSegment[] }) {
  const total = Math.max(
    1,
    segments.reduce((s, x) => s + x.value, 0),
  );
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className="flex h-full w-full">
          {segments.map((s) => {
            const pct = (s.value / total) * 100;
            if (pct === 0) return null;
            return (
              <div
                key={s.key}
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
                className="h-full transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                style={{
                  width: `${pct}%`,
                  background: s.gradient,
                  opacity: hovered && hovered !== s.key ? 0.35 : 1,
                }}
                aria-label={`${s.label}: ${inr(s.value)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          const dim = hovered && hovered !== s.key;
          return (
            <div
              key={s.key}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
              className="flex items-start gap-2 transition-opacity duration-200"
              style={{ opacity: dim ? 0.4 : 1 }}
            >
              <span
                aria-hidden
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.solid }}
              />
              <div className="flex-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
                  {s.label}
                </div>
                <div className="tabular mt-0.5 text-[15px] font-semibold text-ink">
                  {inr(s.value)}
                </div>
                <div className="tabular text-[11px] text-ink-3">
                  {pct.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
