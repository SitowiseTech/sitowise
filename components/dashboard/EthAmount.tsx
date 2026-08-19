"use client";

import {CountUp} from "@/components/CountUp";
import {formatEth, usdOf, WEI_PER_ETH} from "@/lib/format";

/**
 * An ETH figure with its dollar value underneath (spec 5.3): six decimals,
 * tabular so columns of numbers line up, and no dollar line at all when no
 * quote is available.
 */

export type EthAmountProps = {
  wei: bigint;
  ethUsd: number | null;
  size?: "xl" | "lg" | "md" | "sm";
  /** Count from zero the first time it scrolls into view. Metric cards only. */
  animate?: boolean;
  className?: string;
};

const SIZE = {
  // `xl` is the dashboard's headline balance. It is clamped rather than fixed
  // because 0.000000 ETH is nine glyphs of tabular figures, which overruns a
  // 390px screen at any size that reads as a headline on a desktop.
  xl: "text-[clamp(32px,8.5vw,44px)] leading-[1.05] font-medium tracking-[-0.025em]",
  lg: "text-[30px] leading-[1.1] font-medium tracking-[-0.02em]",
  md: "text-[15px]",
  sm: "text-[14px]",
} as const;

export function EthAmount({
  wei,
  ethUsd,
  size = "md",
  animate = false,
  className,
}: EthAmountProps) {
  const eth = formatEth(wei, 6);
  const usd = usdOf(wei, ethUsd);

  // When the ETH figure counts up, the dollar figure counts with it. Leaving it
  // static would show 0.000000 ETH next to $5.63 for the length of the
  // animation, which reads as a bug.
  const usdValue = ethUsd === null ? null : (Number(wei) / Number(WEI_PER_ETH)) * ethUsd;
  const countUsd = animate && usdValue !== null && usdValue >= 0.01;

  return (
    <span className={["flex flex-col gap-[3px]", className].filter(Boolean).join(" ")}>
      <span className={`tabular ${SIZE[size]}`}>
        {animate ? <CountUp value={eth} decimals={6} grouping={false} /> : eth}{" "}
        <span className={size === "lg" || size === "xl" ? "text-[15px] text-muted" : "text-muted"}>
          ETH
        </span>
      </span>
      {countUsd && usdValue !== null ? (
        <span className="mono-label">
          <CountUp value={usdValue} decimals={2} prefix="$" />
        </span>
      ) : usd ? (
        <span className="mono-label">{usd}</span>
      ) : null}
    </span>
  );
}
