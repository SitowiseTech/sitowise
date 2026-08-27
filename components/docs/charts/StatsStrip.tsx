"use client";

import {useApiJson} from "@/components/docs/charts/useApiJson";
import {formatEth} from "@/lib/format";

/**
 * Protocol totals from GET /api/stats, shown on the docs overview so the first
 * page a reader opens carries real figures rather than a description of them.
 *
 * Every cell renders "No data yet" independently. A stats row that hides itself
 * when one field is missing tells the reader less than one that admits it.
 */

type Stats = {
  totalNodes?: number;
  totalDistributedWei?: string | number;
  distributions24hWei?: string | number;
  operators?: number;
};

function wei(value: string | number | undefined): string | null {
  if (value === undefined || value === null) return null;
  try {
    return `${formatEth(BigInt(typeof value === "number" ? Math.trunc(value) : value))} ETH`;
  } catch {
    return null;
  }
}

function count(value: number | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : null;
}

export function StatsStrip() {
  const {data, loading, error} = useApiJson<Stats>("/api/stats");

  const cells: Array<{label: string; value: string | null}> = [
    {label: "Nodes deployed", value: count(data?.totalNodes)},
    {label: "Operators", value: count(data?.operators)},
    // Kept short: these labels sit in a quarter-width cell and a wrapped mono
    // label knocks the figure below it out of line with its neighbours.
    {label: "Credited total", value: wei(data?.totalDistributedWei)},
    {label: "Credited 24h", value: wei(data?.distributions24hWei)},
  ];

  return (
    <div className="panel mb-7 grid grid-cols-2 md:grid-cols-4">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={`border-line p-4 sm:p-5 ${i % 2 === 1 ? "border-l" : ""} ${
            i < 2 ? "border-b md:border-b-0" : ""
          } ${i === 2 ? "md:border-l" : ""} ${i === 3 ? "md:border-l" : ""}`}
        >
          <div className="mono-label">{cell.label}</div>
          <div className="tabular mt-2 font-mono text-[15px] text-ink">
            {loading ? (
              <span className="skeleton block h-[18px] w-[92px]" />
            ) : (
              (cell.value ?? <span className="text-faint">No data yet</span>)
            )}
          </div>
        </div>
      ))}
      {error ? (
        <div className="col-span-2 border-t border-line px-4 py-3 font-mono text-[12px] text-faint md:col-span-4">
          {error}
        </div>
      ) : null}
    </div>
  );
}
