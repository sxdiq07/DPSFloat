"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function AgeingDonut({
  slices,
  total,
}: {
  slices: DonutSlice[];
  total: number;
}) {
  const hasData = slices.some((s) => s.value > 0);

  return (
    <div className="relative flex h-[280px] items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={hasData ? slices : [{ key: "empty", label: "empty", value: 1, color: "var(--color-surface-2)" }]}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={72}
            outerRadius={110}
            paddingAngle={hasData ? 2 : 0}
            strokeWidth={0}
            isAnimationActive
            animationDuration={900}
          >
            {(hasData ? slices : [{ key: "empty", color: "var(--color-surface-2)" }]).map(
              (s) => (
                <Cell key={s.key} fill={s.color} />
              ),
            )}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center label */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">
          Outstanding
        </div>
        <div className="tabular mt-1 text-[22px] font-semibold text-ink">
          {hasData ? inr(total) : "—"}
        </div>
      </div>
    </div>
  );
}
