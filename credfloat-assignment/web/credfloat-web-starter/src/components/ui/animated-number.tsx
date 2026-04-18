"use client";

import { useEffect, useRef, useState } from "react";

const inFmt = new Intl.NumberFormat("en-IN");

export function AnimatedNumber({
  value,
  duration = 900,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      setDisplay(value);
      return;
    }
    started.current = true;

    const startTs = performance.now();
    const from = 0;
    const to = value;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTs) / duration);
      setDisplay(from + (to - from) * ease(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <span className={className}>{inFmt.format(Math.round(display))}</span>;
}
