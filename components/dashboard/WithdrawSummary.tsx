"use client";

import {txUrl} from "@/lib/chain";
import {formatEth, nodeLabel} from "@/lib/format";

/**
 * What the withdraw modal shows once the transaction has landed.
 *
 * One transaction can empty several nodes: `withdrawAll` emits a Withdrawn
 * event per node it moved. Each of those gets its own line with its own
 * amount, because "0.31 ETH withdrawn" tells the user less than which nodes it
 * came out of, and the explorer link is the same for all of them.
 */

export type WithdrawResult = {
  chainNodeId: bigint;
  hash: `0x${string}`;
  amountWei: bigint;
};

export type WithdrawSummaryProps = {
  results: WithdrawResult[];
  destination: string;
};

export function WithdrawSummary({results, destination}: WithdrawSummaryProps) {
  const moved = results.reduce((sum, result) => sum + result.amountWei, 0n);
  const hash = results[0]?.hash ?? null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] leading-[1.55] text-muted">
        {formatEth(moved, 6)} ETH sent to{" "}
        <span className="font-mono text-[13px] break-all text-ink">{destination}</span>.
      </p>

      <ul className="flex flex-col gap-2">
        {results.map((result) => (
          // Keyed by node as well as hash: one transaction can appear here
          // several times, once per node it emptied.
          <li
            key={`${result.hash}:${result.chainNodeId}`}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="font-mono text-[13px] text-muted">
              NODE {nodeLabel(result.chainNodeId.toString())}
            </span>
            <span className="tabular text-[14px]">{formatEth(result.amountWei, 6)} ETH</span>
          </li>
        ))}
      </ul>

      {hash ? (
        <a
          href={txUrl(hash)}
          target="_blank"
          rel="noreferrer noopener"
          className="mono-label text-orange hover:underline"
        >
          View transaction
        </a>
      ) : null}
    </div>
  );
}
