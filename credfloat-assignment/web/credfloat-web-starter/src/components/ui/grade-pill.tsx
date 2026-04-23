import { type Grade, gradeTone } from "@/lib/scoring";

/**
 * Credit grade pill — A / B / C / D / F / —
 * Used identically on the debtor row and clients list. Pass a
 * `tooltip` prop with the score breakdown for hover-to-explain.
 */
export function GradePill({
  grade,
  tooltip,
  size = "md",
}: {
  grade: Grade | null;
  tooltip?: string;
  size?: "sm" | "md";
}) {
  const tone = gradeTone(grade);
  const dims =
    size === "sm"
      ? "h-5 min-w-[20px] px-1.5 text-[10.5px]"
      : "h-6 min-w-[24px] px-2 text-[11.5px]";
  return (
    <span
      className={`inline-flex ${dims} items-center justify-center rounded-md font-semibold tracking-wide tabular`}
      style={{
        color: tone.color,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
      }}
      title={tooltip}
    >
      {tone.label}
    </span>
  );
}
