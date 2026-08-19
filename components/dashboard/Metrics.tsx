"use client";

import type {ReactNode} from "react";
import {CountUp} from "@/components/CountUp";
import {Reveal} from "@/components/Reveal";
import {Button} from "@/components/ui/Button";
import {EthAmount} from "@/components/dashboard/EthAmount";
import type {Totals} from "@/components/dashboard/useDashboardData";

/**
 * The figures at the top of the dashboard (spec 5.2).
 *
 * Every one of them is a sum over the rows below, and every row's figures come
 * out of `nodeInfo`, so nothing here can disagree with the table or with the
 * contract.
 *
 * The panel is rendered whether or not the wallet holds a node. A wallet with
 * nothing in it sees four honest zeros and the shape of the page it is buying
 * into, which is the truth; an empty page implies there is nothing here to see,
 * which is not.
 *
 * Total balance gets its own row and the only filled button on the page. It is
 * one half of the withdrawal surface — the other half is the button on each
 * node row — and burying either one behind a menu would be hiding the two
 * things this page exists to do.
 */

export type MetricsProps = {
  totals: Totals;
  limit: number;
  ethUsd: number | null;
  onWithdrawAll: () => void;
};

function Tile({label, children, index}: {label: string; children: ReactNode; index: number}) {
  return (
    <Reveal variant="panel" index={index} className="panel flex flex-col gap-2 p-5">
      <span className="mono-label">{label}</span>
      {children}
    </Reveal>
  );
}

export function Metrics({totals, limit, ethUsd, onWithdrawAll}: MetricsProps) {
  const nothingToWithdraw = totals.balanceWei === 0n;
  const noNodes = totals.count === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* The wash is the landing page's, at the lower ceiling `.wash-quiet`
          defines. One surface carries it on this page: the figure the whole
          dashboard is about. */}
      <Reveal
        variant="panel"
        className="wash wash-quiet panel flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between lg:gap-10"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <span className="mono-label">Total balance</span>
          <EthAmount wei={totals.balanceWei} ethUsd={ethUsd} size="xl" animate />
          <p className="text-[14px] leading-[1.5] text-muted">
            {noNodes
              ? "Held in the contract. Nothing is here until a node is deployed."
              : `Held in the contract across ${totals.count} ${
                  totals.count === 1 ? "node" : "nodes"
                }, withdrawable at any time.`}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
          <Button onClick={onWithdrawAll} disabled={nothingToWithdraw}>
            Withdraw all
          </Button>
          {/* A disabled button explains itself here in plain text rather than
              in a tooltip: the wash clips its overflow, and a reason worth
              giving is worth giving without a hover. */}
          <span className="mono-label lg:text-right">
            {nothingToWithdraw
              ? "Nothing has accrued yet"
              : "Empties every node in one transaction"}
          </span>
        </div>
      </Reveal>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Nodes owned" index={1}>
          <span className="tabular text-[30px] leading-[1.1] font-medium tracking-[-0.02em]">
            <CountUp value={totals.count} decimals={0} />
            <span className="ml-2 text-[15px] text-muted">{` of ${limit}`}</span>
          </span>
        </Tile>

        <Tile label="Total received" index={2}>
          <EthAmount wei={totals.cumulativeWei} ethUsd={ethUsd} size="lg" animate />
        </Tile>

        <Tile label="Total withdrawn" index={3}>
          <EthAmount wei={totals.withdrawnWei} ethUsd={ethUsd} size="lg" animate />
        </Tile>
      </div>
    </div>
  );
}
