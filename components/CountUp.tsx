"use client";

import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {observeOnce, prefersReducedMotion} from "@/components/Reveal";

/**
 * Counts a metric from zero to its value over 1.2s the first time it scrolls
 * into view (spec 16).
 *
 * The final value is what renders on the server, so crawlers and JS-off
 * readers see the real number, and the reset to zero happens in a layout
 * effect before the browser paints. Values arrive as bigint-derived strings
 * (`formatEth` output) as often as they arrive as numbers, so the component
 * takes both and infers the decimal count from the string when it can.
 */

const DEFAULT_DURATION_MS = 1200;

// useLayoutEffect warns when it is reached during SSR; it never runs there
// anyway, so pick the effect that is correct for the environment.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export type CountUpProps = {
  value: number | bigint | string;
  /** Fixed decimals. Inferred from a string value when omitted. */
  decimals?: number;
  durationMs?: number;
  /** Thousands separators. Off suits wei-scale ETH amounts. */
  grouping?: boolean;
  prefix?: string;
  suffix?: string;
  className?: string;
};

type Target = {value: number; decimals: number};

function resolve(input: number | bigint | string): Target {
  if (typeof input === "number") {
    return {value: Number.isFinite(input) ? input : 0, decimals: 0};
  }
  if (typeof input === "bigint") {
    // Precision beyond 2^53 does not survive, but a counter is display only.
    return {value: Number(input), decimals: 0};
  }
  const cleaned = input.replace(/[\s,]/g, "").trim();
  const parsed = Number(cleaned);
  const dot = cleaned.indexOf(".");
  return {
    value: Number.isFinite(parsed) ? parsed : 0,
    decimals: dot === -1 ? 0 : cleaned.length - dot - 1,
  };
}

/** Ease-out cubic: fast off the mark, settles without overshoot. */
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function CountUp({
  value,
  decimals,
  durationMs = DEFAULT_DURATION_MS,
  grouping = true,
  prefix,
  suffix,
  className,
}: CountUpProps) {
  const target = resolve(value);
  const places = decimals ?? target.decimals;

  const ref = useRef<HTMLSpanElement | null>(null);
  const frame = useRef(0);
  const done = useRef(false);

  // null means "show the target": the server state and the resting state.
  const [shown, setShown] = useState<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // A value that changes after the animation has already played (a dashboard
    // refresh) should snap, not rewind to zero. Same for anyone who asked the
    // system to stop moving things.
    if (done.current || prefersReducedMotion()) {
      setShown(null);
      return;
    }

    setShown(0);
    const stop = observeOnce(el, () => {
      const from = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - from) / durationMs);
        if (t >= 1) {
          done.current = true;
          setShown(null);
          return;
        }
        setShown(target.value * ease(t));
        frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    });

    return () => {
      stop();
      cancelAnimationFrame(frame.current);
    };
    // target.value is the only input that should restart the count.
  }, [target.value, durationMs]);

  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    useGrouping: grouping,
  });

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatter.format(shown ?? target.value)}
      {suffix}
    </span>
  );
}
