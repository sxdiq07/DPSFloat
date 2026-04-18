"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendPoint = { month: string; label: string; total: number };

function compactINR(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}k`;
  return `₹${n.toFixed(0)}`;
}

export function CollectionsTrend({ data }: { data: TrendPoint[] }) {
  const hasData = data.some((d) => d.total > 0);
  if (!hasData) {
    return (
      <div className="flex h-[260px] items-center justify-center text-[13px] text-ink-3">
        No receipts recorded yet. Once receipts sync, this trends 12 months.
      </div>
    );
  }
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="collectionsArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0a84ff" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#0a84ff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border-subtle)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            stroke="var(--color-ink-3)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="var(--color-ink-3)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactINR}
            width={60}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-border-hair)", strokeWidth: 1 }}
            contentStyle={{
              borderRadius: 10,
              border: "1px solid var(--color-border-subtle)",
              background: "var(--color-surface-3)",
              boxShadow: "var(--shadow-apple-md)",
              fontSize: 12,
              padding: "8px 12px",
            }}
            labelStyle={{ color: "var(--color-ink-3)", marginBottom: 4 }}
            formatter={(value: number) => [compactINR(value), "Collections"]}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke="#0a84ff"
            strokeWidth={2}
            fill="url(#collectionsArea)"
            isAnimationActive
            animationDuration={900}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
