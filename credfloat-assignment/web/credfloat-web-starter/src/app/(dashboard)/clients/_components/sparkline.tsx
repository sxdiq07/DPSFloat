"use client";

type Props = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
};

export function Sparkline({
  data,
  width = 96,
  height = 22,
  stroke = "#0a84ff",
}: Props) {
  if (data.length === 0) {
    return <span className="text-[11px] text-ink-3">—</span>;
  }
  const max = Math.max(...data, 1);
  const min = 0;
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = data[data.length - 1];
  const lastX = (data.length - 1) * step;
  const lastY = height - ((last - min) / range) * height;

  const isFlat = data.every((v) => v === 0);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="inline-block"
    >
      {isFlat ? (
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--color-border-subtle)"
          strokeDasharray="2 2"
        />
      ) : (
        <>
          <polyline
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points}
          />
          <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
        </>
      )}
    </svg>
  );
}
