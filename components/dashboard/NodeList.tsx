"use client";

import {useCallback, useState, type ReactNode} from "react";
import {ArrowRightIcon} from "@/components/icons";
import {Reveal} from "@/components/Reveal";
import {Button} from "@/components/ui/Button";
import {EthAmount} from "@/components/dashboard/EthAmount";
import {NodeDetails} from "@/components/dashboard/NodeDetails";
import {Tooltip} from "@/components/dashboard/Tooltip";
import type {DashNode} from "@/components/dashboard/useDashboardData";
import type {NodeDetail} from "@/lib/apiClient";
import {nodeLabel} from "@/lib/format";
import {dateOrNothing} from "@/components/dashboard/dates";

/**
 * One row per node (spec 5.2).
 *
 * This is a list, not a `<table>`. Spec 5.3 requires the rows to become cards
 * on a phone rather than scroll sideways, and a grid that reflows into a
 * stacked card carries its own per-cell labels; a table would need either a
 * horizontal scroller or a second copy of every row.
 *
 * The panel and its column header are rendered even when the wallet owns
 * nothing. A newcomer should be able to see what a node row will tell them
 * before they buy one, and the body then says so in as many words instead of
 * inventing a sample row.
 */

const COLUMNS =
  "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_auto]";

export type NodeListProps = {
  nodes: DashNode[];
  details: Map<number, NodeDetail>;
  detailErrors: Map<number, string>;
  ethUsd: number | null;
  onWithdraw: (node: DashNode) => void;
  onLoadDetail: (node: DashNode) => void;
  /** Opens the deploy flow from the empty state. */
  onDeploy: () => void;
  /** False at the per-wallet cap, which the empty state cannot reach anyway. */
  canDeploy: boolean;
};

/** Mobile-only caption above a value; the desktop header carries it instead. */
function Cell({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex items-baseline justify-between gap-3 md:block">
      <span className="mono-label md:hidden">{label}</span>
      {children}
    </div>
  );
}

/**
 * What the panel holds before the first node exists. It uses the landing
 * page's capability-card surface, so the dashboard's empty state is drawn in
 * the same hand as the page that sold it, and it states zeros rather than
 * showing a mocked-up row.
 */
function NoNodes({onDeploy, canDeploy}: {onDeploy: () => void; canDeploy: boolean}) {
  return (
    <div className="border-t border-line p-4 sm:p-5">
      <div className="cap-card flex flex-col gap-4 p-6 sm:p-8">
        <span className="mono-label">Nothing deployed</span>
        <h3 className="h3 max-w-[30ch]">This wallet does not hold a node yet.</h3>
        <p className="max-w-[52ch] text-[14.5px] leading-[1.6] text-muted">
          A node is minted to your wallet by the contract. Once one exists it
          appears here as a row, with its own balance, everything it has ever
          been credited, and everything that has been taken out of it. Every
          figure on this page is read from the contract, so the zeros above are
          the contract&rsquo;s answer, not a placeholder.
        </p>
        <div className="pt-1">
          <Button onClick={onDeploy} disabled={!canDeploy}>
            Deploy your first node
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NodeList({
  nodes,
  details,
  detailErrors,
  ethUsd,
  onWithdraw,
  onLoadDetail,
  onDeploy,
  canDeploy,
}: NodeListProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const toggle = useCallback(
    (node: DashNode) => {
      setExpanded((current) => {
        if (current === node.id) return null;
        // Detail is normally already in hand from the initial load; this covers
        // a row whose fetch failed or a node added since.
        if (!details.has(node.id)) onLoadDetail(node);
        return node.id;
      });
    },
    [details, onLoadDetail],
  );

  return (
    <Reveal variant="panel" className="panel">
      <div className="flex min-h-[52px] items-center justify-between gap-4 px-4 sm:px-5">
        <span className="mono-label">Your nodes</span>
        <span className="mono-label">{nodes.length}</span>
      </div>

      <div className={`hidden gap-4 border-t border-line px-5 py-3 md:grid ${COLUMNS}`}>
        <span className="mono-label">Node</span>
        <span className="mono-label">Deployed</span>
        <span className="mono-label">Balance</span>
        <span className="mono-label">Total received</span>
        <span className="mono-label" />
      </div>

      {nodes.length === 0 ? (
        <NoNodes onDeploy={onDeploy} canDeploy={canDeploy} />
      ) : (
        <ul>
          {nodes.map((node) => {
            const open = expanded === node.id;
            const empty = node.balanceWei === 0n;

            return (
              <li key={node.id} className="border-t border-line">
                <div className={`grid gap-3 px-4 py-4 sm:px-5 md:items-center md:gap-4 ${COLUMNS}`}>
                  <button
                    type="button"
                    onClick={() => toggle(node)}
                    aria-expanded={open}
                    aria-controls={`node-detail-${node.id}`}
                    className="flex items-center gap-2 rounded-sharp text-left font-mono text-[14px] transition-colors hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
                  >
                    <ArrowRightIcon
                      size={13}
                      className={`shrink-0 text-faint transition-transform duration-200 ${
                        open ? "rotate-90" : ""
                      }`}
                    />
                    NODE {nodeLabel(node.chainNodeId.toString())}
                  </button>

                  <Cell label="Deployed">
                    <span className="text-[14px] text-muted">{dateOrNothing(node.createdAt)}</span>
                  </Cell>

                  <Cell label="Balance">
                    <EthAmount wei={node.balanceWei} ethUsd={ethUsd} size="md" />
                  </Cell>

                  <Cell label="Total received">
                    <EthAmount wei={node.cumulativeWei} ethUsd={ethUsd} size="md" />
                  </Cell>

                  <div className="pt-1 md:pt-0 md:justify-self-end">
                    {empty ? (
                      // The wrapper has to stretch too, or the disabled button
                      // sits at half the width of the enabled one on a phone.
                      <Tooltip
                        label="This node has not accrued anything yet, so there is nothing to withdraw."
                        className="w-full md:w-auto"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled
                          className="w-full justify-center md:w-auto"
                        >
                          Withdraw
                        </Button>
                      </Tooltip>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onWithdraw(node)}
                        className="w-full justify-center md:w-auto"
                      >
                        Withdraw
                      </Button>
                    )}
                  </div>
                </div>

                {open ? (
                  <div id={`node-detail-${node.id}`}>
                    <NodeDetails
                      node={node}
                      detail={details.get(node.id)}
                      error={detailErrors.get(node.id)}
                      ethUsd={ethUsd}
                      onRetry={() => onLoadDetail(node)}
                      onWithdraw={() => onWithdraw(node)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Reveal>
  );
}
