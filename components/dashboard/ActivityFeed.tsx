"use client";

import {ArrowUpRightIcon} from "@/components/icons";
import {Reveal} from "@/components/Reveal";
import {Skeleton} from "@/components/ui/Skeleton";
import {StatusDot} from "@/components/ui/StatusDot";
import {EthAmount} from "@/components/dashboard/EthAmount";
import type {FeedItem} from "@/components/dashboard/useDashboardData";
import {txUrl} from "@/lib/chain";
import {nodeLabel} from "@/lib/format";
import {agoOrNothing} from "@/components/dashboard/dates";

/**
 * Everything that has moved, across every node the wallet holds (spec 5.2).
 * Merged from the per-node detail calls, newest first.
 *
 * Credits and withdrawals sit in one list because they are the same kind of
 * fact: an event that was observed on chain. Neither is a balance, so neither
 * one contradicts the figures above it, and a feed showing only the money
 * arriving would be a strange thing to hand somebody who just moved some out.
 *
 * The panel is rendered with no nodes at all, saying "No data yet". A wallet
 * that has just arrived should be able to see where its activity will appear.
 */

export type ActivityFeedProps = {
  items: FeedItem[];
  loading: boolean;
  ethUsd: number | null;
};

export function ActivityFeed({items, loading, ethUsd}: ActivityFeedProps) {
  return (
    <Reveal variant="panel" className="panel">
      <div className="flex min-h-[52px] items-center justify-between gap-4 px-4 sm:px-5">
        <span className="mono-label">Activity</span>
        <span className="mono-label">Newest first</span>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="border-t border-line p-4 text-[14px] text-faint sm:p-5">No data yet</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-3 sm:px-5"
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="mono-label w-[72px] shrink-0">
                  {agoOrNothing(item.createdAt)}
                </span>
                <span className="font-mono text-[13px] text-muted">
                  NODE {nodeLabel(item.chainNodeId.toString())}
                </span>
                <StatusDot
                  tone={item.kind === "credit" ? "live" : "idle"}
                  label={item.kind === "credit" ? "Credited" : "Withdrawn"}
                  className="shrink-0"
                />
                {item.txHash ? (
                  <a
                    href={txUrl(item.txHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="View transaction"
                    className="shrink-0 text-faint transition-colors hover:text-orange"
                  >
                    <ArrowUpRightIcon size={13} />
                  </a>
                ) : null}
              </span>
              {/* `ml-auto` keeps the amount on the right when the row wraps on
                  a phone; `justify-between` alone leaves it flush left there. */}
              <EthAmount
                wei={item.amountWei}
                ethUsd={ethUsd}
                size="sm"
                className="ml-auto items-end"
              />
            </li>
          ))}
        </ul>
      )}
    </Reveal>
  );
}
