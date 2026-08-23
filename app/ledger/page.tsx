import type {Metadata} from "next";
import {Summary, Td, Th} from "@/app/ledger/parts";
import {Callout} from "@/components/ui/Callout";
import {Panel} from "@/components/ui/Panel";
import {addressUrl} from "@/lib/chain";
import {factoryAddress} from "@/lib/env";
import {formatDate, formatEth, formatEthLabel, nodeLabel, shortAddress, timeAgo} from "@/lib/format";
import {hasActivity, ledgerSummary, recentCredits, recentDistributions} from "@/lib/ledger";
import {FUNDING_NOTE, SITE} from "@/lib/site";

/**
 * The public accrual feed.
 *
 * This is the page that has to be checkable: every row is a round the worker
 * actually committed on chain, and the amounts are the ones that landed on node
 * balances in the contract. Nothing is projected and nothing is rounded up, so
 * when there is no data the page says so rather than showing a zero that reads
 * like a measurement.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ledger",
  description: `Every accrual round Sitowise has credited, node by node. ${FUNDING_NOTE}`,
  openGraph: {
    title: `Ledger · ${SITE.name}`,
    description: "Every accrual round Sitowise has credited, node by node.",
    url: "/ledger",
  },
};

function contractAddress(): string | null {
  try {
    return factoryAddress();
  } catch {
    return null;
  }
}

export default async function LedgerPage() {
  const [summary, distributions, credits] = await Promise.all([
    ledgerSummary(),
    recentDistributions(50),
    recentCredits(50),
  ]);

  const live = hasActivity(summary);
  const contract = contractAddress();

  return (
    <div className="shell flex flex-col gap-8 py-12 sm:py-16">
      <header className="flex max-w-[720px] flex-col gap-4" data-reveal>
        <span className="mono-label">Ledger</span>
        <h1 className="h1">Every round, as it was credited</h1>
        <p className="lede">
          Sitowise credits each active node on its own schedule, sending the ETH on chain in the
          same call that records the round. The amounts below are the ones that landed on node
          balances, so this page, your dashboard and the contract can be compared line by line.
        </p>
      </header>

      <Callout tone="info" className="max-w-[720px]" title="Where the rewards come from">
        {FUNDING_NOTE} Sitowise is a Uniswap v4 hook, and the hook is what will carry the accrual;
        until pools are attached to it there is no swap flow to split.
      </Callout>

      <Panel label="Totals" padding="none" reveal>
        <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Summary
            label="Credited to date"
            value={live ? formatEthLabel(summary.totalDistributedWei) : "No data yet"}
            hint={
              summary.firstDistributionAt
                ? `Since ${formatDate(summary.firstDistributionAt)}`
                : undefined
            }
          />
          <Summary
            label="Last 24 hours"
            value={live ? formatEthLabel(summary.distributed24hWei) : "No data yet"}
            hint={live ? `${summary.rounds24h} rounds` : undefined}
          />
          <Summary
            label="Rounds recorded"
            value={live ? summary.totalRounds.toLocaleString("en-US") : "No data yet"}
            hint={
              summary.lastDistributionAt ? `Most recent ${timeAgo(summary.lastDistributionAt)}` : undefined
            }
          />
          <Summary
            label="Active nodes"
            value={summary.activeNodes > 0 ? summary.activeNodes.toLocaleString("en-US") : "No data yet"}
            hint={summary.operators > 0 ? `${summary.operators} wallets` : undefined}
          />
        </div>
        {contract ? (
          <p className="border-t border-line px-5 py-4 text-[13px] text-muted">
            Payouts are held by{" "}
            <a
              href={addressUrl(contract)}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[12.5px] text-ink underline decoration-line underline-offset-4 hover:text-orange"
            >
              {shortAddress(contract, 10, 8)}
            </a>{" "}
            on Robinhood Chain. Node balances, withdrawals and the totals credited and paid out
            are all readable there.
          </p>
        ) : null}
      </Panel>

      <Panel label="Recent rounds" padding="none" reveal revealDelay={80}>
        {distributions.length === 0 ? (
          <p className="px-5 py-8 text-[14px] text-muted">
            No rounds yet. The first one appears here the moment it is credited.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  <Th align="left">Time</Th>
                  <Th>Nodes</Th>
                  <Th>Total</Th>
                  <Th>Per node</Th>
                </tr>
              </thead>
              <tbody>
                {distributions.map((round) => (
                  <tr key={round.id}>
                    <Td align="left">
                      <span title={round.createdAt.toISOString()}>{timeAgo(round.createdAt)}</span>
                    </Td>
                    <Td>{round.nodeCount}</Td>
                    <Td>{formatEth(round.totalWei)}</Td>
                    <Td className="text-muted">
                      {round.nodeCount > 0 ? formatEth(round.totalWei / BigInt(round.nodeCount)) : "0"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel label="Recent credits" padding="none" reveal revealDelay={160}>
        {credits.length === 0 ? (
          <p className="px-5 py-8 text-[14px] text-muted">
            No credits yet. Each node gets its own line here, drawn independently of the others.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  <Th align="left">Time</Th>
                  <Th align="left">Node</Th>
                  <Th align="left">Operator</Th>
                  <Th>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {credits.map((credit) => (
                  <tr key={credit.id}>
                    <Td align="left">
                      <span title={credit.createdAt.toISOString()}>{timeAgo(credit.createdAt)}</span>
                    </Td>
                    <Td align="left">{nodeLabel(credit.chainNodeId)}</Td>
                    <Td align="left">
                      <a
                        href={addressUrl(credit.ownerAddress)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono text-[12.5px] hover:text-orange"
                      >
                        {shortAddress(credit.ownerAddress)}
                      </a>
                    </Td>
                    <Td>{formatEth(credit.amountWei)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="max-w-[720px] text-[13px] leading-[1.6] text-faint">
        Amounts are in ETH, truncated to six decimals. A credit is recorded when the round commits;
        moving it to your wallet is a separate transaction you send yourself.
      </p>
    </div>
  );
}
