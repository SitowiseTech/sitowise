"use client";

import {useMemo, useState} from "react";
import {ChartFrame} from "@/components/docs/charts/ChartFrame";
import {useApiJson} from "@/components/docs/charts/useApiJson";
import {formatEth} from "@/lib/format";

/**
 * Credited value over time, from GET /api/distributions.
 *
 * The endpoint returns rounds, not a time series, so the bucketing happens
 * here: hourly across a day, daily across a week. Sums stay in bigint until the
 * moment a pixel or a label needs them, because a week of rounds adds up past
 * what a double can hold exactly and the labels are meant to be checkable
 * against the explorer.
 */

type Round = {
  id?: number | string;
  totalWei?: string | number;
  nodeCount?: number;
  createdAt?: string;
};

type Range = "24h" | "7d";

type Bucket = {
  label: string;
  /** Value credited inside this bucket. */
  wei: bigint;
  rounds: number;
};

/**
 * The endpoint caps `limit` at 200 and answers 400 above it, so this asks for
 * exactly the ceiling. A week of rounds can exceed that, in which case the
 * chart covers the most recent 200 and the footer says how many it drew.
 */
const ROUND_LIMIT = 200;

const VIEW = {w: 720, h: 240, left: 58, right: 12, top: 16, bottom: 28};
const PLOT_W = VIEW.w - VIEW.left - VIEW.right;
const PLOT_H = VIEW.h - VIEW.top - VIEW.bottom;

/** `0.001200` reads worse than `0.0012` on an axis. */
function trimEth(wei: bigint): string {
  const text = formatEth(wei, 6);
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

function hourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {day: "numeric", month: "short"});
}

function toWei(value: string | number | undefined): bigint {
  if (value === undefined || value === null) return 0n;
  try {
    return BigInt(typeof value === "number" ? Math.trunc(value) : value.trim() || "0");
  } catch {
    // A malformed row must not take the whole chart down with it.
    return 0n;
  }
}

function bucketRounds(rounds: readonly Round[], range: Range, now: number): Bucket[] {
  const bucketMs = range === "24h" ? 3_600_000 : 86_400_000;
  const count = range === "24h" ? 24 : 7;
  const end = Math.floor(now / bucketMs) * bucketMs + bucketMs;
  const start = end - count * bucketMs;

  const buckets: Bucket[] = Array.from({length: count}, (_, i) => ({
    label: range === "24h" ? hourLabel(start + i * bucketMs) : dayLabel(start + i * bucketMs),
    wei: 0n,
    rounds: 0,
  }));

  for (const round of rounds) {
    if (!round.createdAt) continue;
    const at = Date.parse(round.createdAt);
    if (Number.isNaN(at) || at < start || at >= end) continue;
    const index = Math.min(count - 1, Math.floor((at - start) / bucketMs));
    buckets[index].wei += toWei(round.totalWei);
    buckets[index].rounds += 1;
  }

  return buckets;
}

export function CreditsChart() {
  const [range, setRange] = useState<Range>("24h");
  const [hover, setHover] = useState<number | null>(null);
  const {data, loading, error} = useApiJson<Round[]>(`/api/distributions?limit=${ROUND_LIMIT}`);

  const rounds = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Bucketing is pinned to the moment the data arrived, not to every render,
  // so the axis does not creep while the reader is hovering it.
  const buckets = useMemo(() => bucketRounds(rounds, range, Date.now()), [rounds, range]);

  const total = buckets.reduce((sum, b) => sum + b.wei, 0n);
  const peak = buckets.reduce((max, b) => (b.wei > max ? b.wei : max), 0n);
  const roundCount = buckets.reduce((sum, b) => sum + b.rounds, 0);

  const control = (
    <div className="doc-seg" role="group" aria-label="Time range">
      {(["24h", "7d"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={range === option}
          onClick={() => {
            setRange(option);
            setHover(null);
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );

  let empty: string | null = null;
  if (loading) empty = "Loading distribution rounds.";
  else if (error) empty = error;
  else if (total === 0n) {
    empty =
      range === "24h"
        ? "No distribution rounds have been recorded in the last 24 hours."
        : "No distribution rounds have been recorded in the last 7 days.";
  }

  // Scale to the peak with a little headroom so the tallest point is not
  // welded to the top edge of the plot.
  const ceiling = peak === 0n ? 1n : peak;
  const yOf = (wei: bigint) => {
    const ratio = Number(wei) / Number(ceiling);
    return VIEW.top + PLOT_H - ratio * PLOT_H * 0.88;
  };
  const xOf = (index: number) =>
    buckets.length === 1
      ? VIEW.left + PLOT_W / 2
      : VIEW.left + (index / (buckets.length - 1)) * PLOT_W;

  const points = buckets.map((bucket, i) => ({x: xOf(i), y: yOf(bucket.wei)}));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area =
    points.length > 0
      ? `${line} L${points[points.length - 1].x.toFixed(1)} ${VIEW.top + PLOT_H} L${points[0].x.toFixed(1)} ${VIEW.top + PLOT_H} Z`
      : "";

  const ticks = [ceiling, ceiling / 2n, 0n];
  const labelEvery = range === "24h" ? 4 : 1;
  const shown = hover !== null ? buckets[hover] : null;

  return (
    <ChartFrame
      label="Credited value over time"
      control={control}
      empty={empty}
      footer={
        <div className="doc-chart-readout">
          {shown ? (
            <>
              <span className="text-ink">{shown.label}</span>
              <span>{formatEth(shown.wei)} ETH</span>
              <span className="text-faint">
                {shown.rounds} {shown.rounds === 1 ? "round" : "rounds"}
              </span>
            </>
          ) : (
            <>
              <span className="text-ink">{range === "24h" ? "Last 24 hours" : "Last 7 days"}</span>
              <span>{formatEth(total)} ETH</span>
              <span className="text-faint">
                {roundCount} {roundCount === 1 ? "round" : "rounds"}
                {rounds.length >= ROUND_LIMIT ? `, capped at the ${ROUND_LIMIT} most recent` : ""}
              </span>
            </>
          )}
        </div>
      }
    >
      <svg
        className="doc-chart"
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        role="img"
        aria-label={`Value credited per ${range === "24h" ? "hour" : "day"}, totalling ${formatEth(total)} ETH`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const scale = VIEW.w / rect.width;
          const x = (event.clientX - rect.left) * scale;
          const ratio = (x - VIEW.left) / PLOT_W;
          const index = Math.round(ratio * (buckets.length - 1));
          setHover(Math.max(0, Math.min(buckets.length - 1, index)));
        }}
      >
        {ticks.map((tick, i) => {
          const y = yOf(tick);
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

        <path className="doc-chart-area" d={area} />
        <path className="doc-chart-line" d={line} vectorEffect="non-scaling-stroke" />

        {buckets.map((bucket, i) =>
          i % labelEvery === 0 ? (
            <text
              key={`label-${bucket.label}-${i}`}
              className="doc-chart-axis"
              x={xOf(i)}
              y={VIEW.h - 8}
              textAnchor={i === 0 ? "start" : i === buckets.length - 1 ? "end" : "middle"}
            >
              {bucket.label}
            </text>
          ) : null,
        )}

        {hover !== null ? (
          <g>
            <line
              className="doc-chart-cursor"
              x1={xOf(hover)}
              x2={xOf(hover)}
              y1={VIEW.top}
              y2={VIEW.top + PLOT_H}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              className="doc-chart-dot"
              cx={xOf(hover)}
              cy={yOf(buckets[hover].wei)}
              r={3.6}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </svg>
    </ChartFrame>
  );
}
