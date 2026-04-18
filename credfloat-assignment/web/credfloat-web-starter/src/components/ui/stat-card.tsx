import { AnimatedNumber } from "./animated-number";

type Tone = "neutral" | "danger" | "success" | "accent";

const toneColors: Record<Tone, { text: string; dot: string }> = {
  neutral: {
    text: "var(--color-ink)",
    dot: "linear-gradient(135deg, #0a84ff, #5856d6)",
  },
  danger: {
    text: "#c6373a",
    dot: "linear-gradient(135deg, #ff453a, #ff375f)",
  },
  success: {
    text: "#1f7a4a",
    dot: "linear-gradient(135deg, #30d158, #34c759)",
  },
  accent: {
    text: "var(--color-accent-blue)",
    dot: "linear-gradient(135deg, #0a84ff, #0071e3)",
  },
};

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  animate = true,
  prefix = "",
  suffix = "",
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: Tone;
  animate?: boolean;
  prefix?: string;
  suffix?: string;
}) {
  const c = toneColors[tone];
  const isNumber = typeof value === "number";

  return (
    <div className="group relative overflow-hidden rounded-[18px] border border-[var(--color-border-subtle)] bg-white p-7 transition-all duration-300 hover:shadow-[var(--shadow-apple-md)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-6 -top-24 h-32 bg-gradient-to-b from-[rgba(0,113,227,0.06)] to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      />

      <div className="relative flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
          {label}
        </span>
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ background: c.dot }}
        />
      </div>

      <div
        className="tabular mt-5 text-[34px] font-semibold leading-none tracking-tight"
        style={{ color: c.text }}
      >
        {prefix && (
          <span style={{ fontWeight: 300, opacity: 0.6, marginRight: "0.05em" }}>
            {prefix}
          </span>
        )}
        {isNumber && animate ? (
          <AnimatedNumber value={value} />
        ) : (
          <>{value}</>
        )}
        {suffix}
      </div>

      {sub && (
        <div className="relative mt-3 text-[12.5px] leading-relaxed text-ink-3">
          {sub}
        </div>
      )}
    </div>
  );
}
