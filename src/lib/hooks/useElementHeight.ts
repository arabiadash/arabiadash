"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measure an element's height via ResizeObserver. Returns a tuple of
 * [ref, height]. Height is 0 until the first observation fires, which
 * callers can use as a "not yet measured" guard before rendering
 * dimension-sensitive children (e.g. Recharts ResponsiveContainer with
 * explicit pixel height, to avoid its `width(-1)/height(-1)` warning).
 *
 * The observer reconnects automatically across breakpoint changes since
 * it tracks contentRect on every resize.
 */
export function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, height] as const;
}
