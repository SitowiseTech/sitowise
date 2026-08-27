"use client";

import {useMemo, useState} from "react";
import {ChartFrame} from "@/components/docs/charts/ChartFrame";
import {useApiJson} from "@/components/docs/charts/useApiJson";
import {formatEth, isAddress, nodeLabel} from "@/lib/format";

/**
 * Per-node distribution for one wallet, from GET /api/nodes/:address.
 *
 * Each bar is split: the lower part is value already withdrawn, the upper part
 * is what is still on the contract. Plotting only the balance would make a
 * wallet that has withdrawn look like a wallet that never accrued, which is the
 * opposite of what this chart is for.
 *
 * The address is typed by the reader. There is no default wallet, because
 * filling one in would put someone else's holdings on a documentation page.
 */

type NodeRow = {
  id?: number | string;
  chainNodeId?: number | string;
  balanceWei?: string | number;
  cumulativeWei?: string | number;
  withdrawnWei?: string | number;
};

const VIEW = {w: 720, h: 240, left: 58, right: 12, top: 16, bottom: 30};
const PLOT_W = VIEW.w - VIEW.left - VIEW.right;
const PLOT_H = VIEW.h - VIEW.top - VIEW.bottom;

function toWei(value: string | number | undefined): bigint {
  if (value === undefined || value === null) return 0n;
  try {
    return BigInt(typeof value === "number" ? Math.trunc(value) : value.trim() || "0");
  } catch {
    return 0n;
  }
}

function trimEth(wei: bigint): string {
  const text = formatEth(wei, 6);
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

type Bar = {
  label: string;
  cumulative: bigint;
  withdrawn: bigint;
  balance: bigint;
};

export function NodeBarsChart() {
  const [draft, setDraft] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const {data, loading, error} = useApiJson<NodeRow[]>(address ? `/api/nodes/${address}` : null);

  const bars: Bar[] = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data.map((row, i) => {
      const withdrawn = toWei(row.withdrawnWei);
      const cumulativeRaw = toWei(row.cumulativeWei);
      const balance = toWei(row.balanceWei);
      // cumulative is authoritative when present; otherwise reconstruct it, so
      // an API that only returns two of the three still plots correctly.
      const cumulative = cumulativeRaw > 0n ? cumulativeRaw : withdrawn + balance;
      return {
        label: nodeLabel(row.chainNodeId ?? row.id ?? i + 1),
        cumulative,
        withdrawn,
        balance: cumulative > withdrawn ? cumulative - withdrawn : balance,
      };
    });
  }, [data]);

  const peak = bars.reduce((max, bar) => (bar.cumulative > max ? bar.cumulative : max), 0n);
  const total = bars.reduce((sum, bar) => sum + bar.cumulative, 0n);

  const invalid = draft.trim().length > 0 && !isAddress(draft.trim());

  let empty: string | null = null;
  if (!address) empty = "Enter a wallet address to plot the nodes it holds.";
  else if (loading) empty = "Loading nodes.";
  else if (error) empty = error;
  else if (bars.length === 0) empty = "This wallet does not hold any nodes.";
  else if (peak === 0n) empty = "These nodes have not been credited any value yet.";

  const ceiling = peak === 0n ? 1n : peak;
  const heightOf = (wei: bigint) => (Number(wei) / Number(ceiling)) * PLOT_H * 0.88;
  const slot = bars.length > 0 ? PLOT_W / bars.length : PLOT_W;
  const barWidth = Math.min(38, Math.max(6, slot * 0.62));
  const centreOf = (index: number) => VIEW.left + slot * (index + 0.5);
  const ticks = [ceiling, ceiling / 2n, 0n];
  const shown = hover !== null ? bars[hover] : null;
  // 25 nodes per wallet is the cap, and 25 mono labels do not fit across the
  // plot, so thin them once the slots get narrow.
  const labelEvery = bars.length > 14 ? 3 : bars.length > 8 ? 2 : 1;

  const control = (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = draft.trim();
        if (!isAddress(value)) return;
        setHover(null);
        setAddress(value.toLowerCase());
      }}
    >
      <label className="sr-only" htmlFor="node-bars-address">
        Wallet address
      </label>
      <input
        id="node-bars-address"
        // Narrow enough that the input and its button share a line beside the
        // panel label at the documentation column width.
        className={`field field-mono h-9 w-[min(240px,52vw)] ${invalid ? "invalid" : ""}`}
        placeholder="0x…"
        spellCheck={false}
        autoComplete="off"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-invalid={invalid}
      />
      <button
        type="submit"
        className="btn btn-ghost h-9 px-4 text-[13px]"
        aria-disabled={!isAddress(draft.trim())}
      >
        Load
      </button>
    </form>
  );

  return (
    <ChartFrame
      label="Value credited per node"
      control={control}
      empty={empty}
      footer={
        <div className="doc-chart-readout">
          {shown ? (
            <>
              <span className="text-ink">{shown.label}</span>
              <span>{formatEth(shown.cumulative)} ETH credited</span>
              <span className="text-faint">{formatEth(shown.withdrawn)} ETH withdrawn</span>
            </>
          ) : (
            <>
              <span className="text-ink">
                {bars.length} {bars.length === 1 ? "node" : "nodes"}
              </span>
              <span>{formatEth(total)} ETH credited</span>
              <span className="text-faint">Filled: on contract. Outlined: withdrawn.</span>
            </>
          )}
        </div>
      }
    >
      <svg
        className="doc-chart"
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        role="img"
        aria-label={`Value credited to each of ${bars.length} nodes, totalling ${formatEth(total)} ETH`}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((tick, i) => {
          const y = VIEW.top + PLOT_H - heightOf(tick);
          return (
            <g key={`tick-${i}`}>
              <line
                className="doc-chart-grid"
                x1={VIEW.left}
                x2={VIEW.left + PLOT_W}
                y1={y}
                y2={y}
                vectorEffect="non-scaling-stroke"
              />
              <text className="doc-chart-axis" x={VIEW.left - 10} y={y + 3} textAnchor="end">
                {trimEth(tick)}
              </text>
            </g>
          );
        })}

        {bars.map((bar, i) => {
          const x = centreOf(i) - barWidth / 2;
          const full = heightOf(bar.cumulative);
          const withdrawn = heightOf(bar.withdrawn);
          const remaining = Math.max(0, full - withdrawn);
          const baseline = VIEW.top + PLOT_H;
          return (
            // The whole plot carries one aria-label; individual bars stay out
            // of the accessibility tree rather than nesting roles inside it.
            <g key={`${bar.label}-${i}`} onPointerEnter={() => setHover(i)}>
              {/* Invisible full-height target so thin bars stay hoverable. */}
              <rect
                x={centreOf(i) - slot / 2}
                y={VIEW.top}
                width={slot}
                height={PLOT_H}
                fill="transparent"
              />
              <rect
                className="doc-chart-bar"
                data-hover={hover === i ? "true" : "false"}
                x={x}
                y={baseline - full}
                width={barWidth}
                height={remaining}
              />
              <rect
                className="doc-node-box"
                x={x}
                y={baseline - withdrawn}
                width={barWidth}
                height={withdrawn}
                vectorEffect="non-scaling-stroke"
              />
              {i % labelEvery === 0 ? (
                <text
                  className="doc-chart-axis"
                  x={centreOf(i)}
                  y={VIEW.h - 10}
                  textAnchor="middle"
                >
                  {bar.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}
