"use client";

import type {ReactNode} from "react";
import {ArrowUpRightIcon} from "@/components/icons";
import {Button} from "@/components/ui/Button";
import {CopyButton} from "@/components/ui/CopyButton";
import {Skeleton} from "@/components/ui/Skeleton";
import {EthAmount} from "@/components/dashboard/EthAmount";
import type {DashNode} from "@/components/dashboard/useDashboardData";
import type {NodeDetail} from "@/lib/apiClient";
import {txUrl} from "@/lib/chain";
import {nodeLabel, shortAddress} from "@/lib/format";
import {agoOrNothing, dateOrNothing} from "@/components/dashboard/dates";

/**
 * Everything there is to know about one node (spec 5.2), in the row that
 * belongs to it: which node it is, when it was minted and by which
 * transaction, what it holds now, what it has been credited and paid out over
 * its whole life, and both histories in full.
 *
 * The three money figures come from `nodeInfo` on the row itself. The two
 * histories come from the ledger, which is the right source for them: a credit
 * and a withdrawal are events that happened, and the contract keeps totals
 * rather than a log. Nothing here reads a balance from the database.
 *
 * Empty sections say "No data yet" rather than borrowing a number from
 * somewhere else or showing a zero that looks like a measurement.
 */

export type NodeDetailsProps = {
  node: DashNode;
  detail: NodeDetail | undefined;
  error: string | undefined;
  ethUsd: number | null;
  onRetry: () => void;
  /** Opens the single-node withdrawal for this node. */
  onWithdraw: () => void;
};

function Figure({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="mono-label">{label}</span>
      {children}
    </div>
  );
}

function Facts({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="mono-label">{label}</span>
      <div className="min-w-0 text-[14px] text-muted">{children}</div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono-label">{title}</span>
        {count === null ? null : <span className="mono-label tabular">{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <p className="text-[14px] text-faint">No data yet</p>;
}

function Loading({lines}: {lines: number}) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({length: lines}, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? "h-4 w-3/5" : "h-4 w-full"} />
      ))}
    </div>
  );
}

export function NodeDetails({
  node,
  detail,
  error,
  ethUsd,
  onRetry,
  onWithdraw,
}: NodeDetailsProps) {
  const empty = node.balanceWei === 0n;

  return (
    <div className="flex flex-col gap-6 border-t border-line bg-panel/60 px-4 py-5 sm:px-5">
      {/* Contract figures first. These three are the node's money and they all
          arrive in one `nodeInfo` call, so they always describe one block. */}
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-5 sm:grid-cols-3">
          <Figure label="Balance">
            <EthAmount wei={node.balanceWei} ethUsd={ethUsd} size="md" />
          </Figure>
          <Figure label="Total received">
            <EthAmount wei={node.cumulativeWei} ethUsd={ethUsd} size="md" />
          </Figure>
          <Figure label="Total withdrawn">
            <EthAmount wei={node.withdrawnWei} ethUsd={ethUsd} size="md" />
          </Figure>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
          <Button size="sm" onClick={onWithdraw} disabled={empty}>
            Withdraw this node
          </Button>
          <span className="mono-label md:text-right">
            {empty ? "Nothing has accrued yet" : "Sends the whole balance"}
          </span>
        </div>
      </div>

      <hr className="rule" />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Facts label="Node">
          <span className="font-mono">NODE {nodeLabel(node.chainNodeId.toString())}</span>
        </Facts>

        <Facts label="Contract id">
          {/* The id the contract takes in `withdraw(id, to)`, spelled out. The
              padded label above is for reading; this is for typing. */}
          <span className="font-mono tabular">{node.chainNodeId.toString()}</span>
        </Facts>

        <Facts label="Deployed">{dateOrNothing(node.createdAt)}</Facts>

        <Facts label="Mint transaction">
          {node.mintTx ? (
            <span className="flex min-w-0 items-center gap-1">
              <a
                href={txUrl(node.mintTx)}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 truncate font-mono text-[13px] text-orange hover:underline"
              >
                {shortAddress(node.mintTx, 10, 8)}
              </a>
              <ArrowUpRightIcon size={13} className="shrink-0 text-faint" />
              <CopyButton value={node.mintTx} label="Copy transaction hash" />
            </span>
          ) : (
            <span className="text-faint">No mint transaction recorded</span>
          )}
        </Facts>
      </div>

      <hr className="rule" />

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Credits" count={detail ? detail.credits.length : null}>
          {error ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[14px] text-muted">{error}</p>
              <Button variant="quiet" size="sm" onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : !detail ? (
            <Loading lines={3} />
          ) : detail.credits.length === 0 ? (
            <Empty />
          ) : (
            // Vertical scroll only. A node with fifty credits must not make the
            // row taller than the screen, and it must never scroll sideways.
            <ul className="flex max-h-[260px] flex-col gap-2 overflow-y-auto pr-1">
              {detail.credits.map((credit) => (
                <li key={credit.id} className="flex items-baseline justify-between gap-3">
                  <span className="mono-label shrink-0">{agoOrNothing(credit.createdAt)}</span>
                  <EthAmount wei={credit.amountWei} ethUsd={null} size="sm" className="items-end" />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Withdrawals" count={detail ? detail.withdrawals.length : null}>
          {error ? (
            <p className="text-[14px] text-muted">{error}</p>
          ) : !detail ? (
            <Loading lines={2} />
          ) : detail.withdrawals.length === 0 ? (
            <Empty />
          ) : (
            <ul className="flex max-h-[260px] flex-col gap-3 overflow-y-auto pr-1">
              {detail.withdrawals.map((withdrawal) => (
                <li key={withdrawal.id} className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="mono-label shrink-0">
                      {agoOrNothing(withdrawal.observedAt)}
                    </span>
                    <EthAmount
                      wei={withdrawal.amountWei}
                      ethUsd={ethUsd}
                      size="sm"
                      className="items-end"
                    />
                  </div>
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-[12px] text-faint">
                      {withdrawal.toAddress ? `to ${shortAddress(withdrawal.toAddress)}` : ""}
                    </span>
                    {withdrawal.txHash ? (
                      <a
                        href={txUrl(withdrawal.txHash)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] text-orange hover:underline"
                      >
                        {shortAddress(withdrawal.txHash, 6, 4)}
                        <ArrowUpRightIcon size={12} />
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
