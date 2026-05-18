"use client";

import { useEffect, useState } from "react";

/**
 * Measure an element's height via ResizeObserver. Returns a tuple of
 * [refCallback, height]. Height is 0 until the first observation fires,
 * which callers can use as a "not yet measured" guard before rendering
 * dimension-sensitive children (e.g. Recharts ResponsiveContainer with
 * explicit pixel height, to avoid its `width(-1)/height(-1)` warning).
 *
 * Uses a callback ref + state pattern (rather than useRef + empty-deps
 * useEffect) so the observer attaches correctly when the target element
 * appears in the DOM AFTER initial render — e.g. when wrapped in a
 * conditional like `{platformPerformance.length > 1 && (...)}` where
 * the data only arrives after async hooks resolve. With a plain useRef
 * + empty-deps useEffect, the observer attach phase reads ref.current
 * === null at mount and never re-runs, leaving height stuck at 0 even
 * after the conditional flips true.
 *
 * The callback ref re-fires when the element mounts/unmounts, which
 * causes the useEffect (deps: [node]) to re-attach the observer
 * correctly.
 */
export function useElementHeight<T extends HTMLElement>() {
  const [height, setHeight] = useState(0);
  const [node, setNode] = useState<T | null>(null);

  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [setNode, height] as const;
}
