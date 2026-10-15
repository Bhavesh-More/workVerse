"use client";

import { useEffect, useState } from "react";

const DURATION = 800;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Counts from 0 to `value` once; renders `fallback` while there is no value. */
export function CountUp({
  value,
  decimals = 0,
  fallback = "—",
}: {
  value: number | null | undefined;
  decimals?: number;
  fallback?: string;
}) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (value == null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      setShown(value * easeOut(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  if (value == null) return <>{fallback}</>;
  return <>{shown.toFixed(decimals)}</>;
}
