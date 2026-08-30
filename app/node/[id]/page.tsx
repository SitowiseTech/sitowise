import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {Panel} from "@/components/ui/Panel";
import {CopyButton} from "@/components/ui/CopyButton";
import {addressUrl, txUrl} from "@/lib/chain";
import {sql} from "@/lib/db";
import {formatDate, formatEth, formatEthLabel, nodeLabel, shortAddress, timeAgo} from "@/lib/format";
import {nodeByChainId, shapeNodeDetail} from "@/lib/nodes";
import {TIER_LABEL} from "@/lib/tierLabels";
import {FUNDING_NOTE, SITE} from "@/lib/site";

/**
 * One node, in public.
 *
 * Everything about a node was already readable: on the contract, through the
 * API, and on the dashboard for whoever owns it. What there was not was a page
 * you could open, or send to somebody, without connecting a wallet first. A
 * holder who wanted to show what their node holds had a screenshot and nothing
 * else.
 *
 * Read from the ledger for history and labelled as such. The contract stays the
 * authority on the money, and every figure here links to where it can be
 * checked rather than asking to be believed.
 */

export const dynamic = "force-dynamic";

type Params = {params: Promise<{id: string}>};

function parseId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  try {
    const value = BigInt(raw);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({params}: Params): Promise<Metadata> {
  const {id} = await params;
  const wanted = parseId(id);
  if (wanted === null) return {title: "Node"};

  const row = await nodeByChainId(wanted).catch(() => null);
  if (!row) return {title: "Node"};

  const node = shapeNodeDetail(row);
  const label = `Node ${nodeLabel(node.chainNodeId)}`;
  const held = formatEthLabel(BigInt(node.balanceWei));

  return {
    title: label,
    description: `${label} on Robinhood Chain holds ${held}, readable on chain. ${FUNDING_NOTE}`,
    openGraph: {
      title: `${label} · ${SITE.name}`,
      description: `Holds ${held}, readable on chain.`,
      url: `/node/${node.chainNodeId}`,
    },
  };
}

type CreditRow = {amount_wei: string; created_at: Date | string | null};
type WithdrawalRow = {
  amount_wei: string;
  to_address: string | null;
  tx_hash: string | null;
  observed_at: Date | string | null;
};

function Figure({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="mono-label">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default async function NodePage({params}: Params) {
  const {id} = await params;
  const wanted = parseId(id);
  if (wanted === null) notFound();

  // By chain id only, never the database row id. `nodeByEitherId` accepts both,
  // which is right for an API a client already holds an id from, and wrong for
  // a link somebody types or sends: /node/74 must be the node everybody sees as
  // 0074, not whichever row happens to be numbered 74 internally.
  const row = await nodeByChainId(wanted).catch(() => null);
  if (!row) notFound();

  const node = shapeNodeDetail(row);
  const chainId = node.chainNodeId;

  const [credits, withdrawals] = await Promise.all([
    sql<CreditRow>`
      select amount_wei, created_at from credits
       where node_id = ${String(row.id)}::bigint
       order by created_at desc limit 10
    `.catch(() => [] as CreditRow[]),
    sql<WithdrawalRow>`
      select amount_wei, to_address, tx_hash, observed_at from withdrawals
       where node_chain_id = ${String(chainId)}::numeric
       order by block_number desc limit 10
    `.catch(() => [] as WithdrawalRow[]),
  ]);

  const tier = TIER_LABEL[node.tier ?? "base"] ?? "Base";

  return (
    <main className="shell flex flex-col gap-6 py-12 sm:py-16">
      <div className="flex flex-col gap-3">
        <span className="mono-label">Node</span>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="text-[38px] leading-[1.05] font-medium tracking-[-0.02em] sm:text-[46px]">
            {nodeLabel(chainId)}
          </h1>
          {/* The base tier carries no badge anywhere else, and adding one here
              only for this page would make the same node look different
              depending on where you met it. */}
          {node.tier && node.tier !== "base" ? (
            <span className="mono-label rounded-sharp border border-line-dark px-2 py-1 text-ink">
              {tier}
            </span>
          ) : null}
        </div>
        <p className="max-w-[62ch] text-[15px] leading-[1.6] text-muted">
          A position in the Sitowise contract on Robinhood Chain. Everything below is readable
          on chain by anyone, with or without this page.
        </p>
      </div>

      <Panel label="What it holds" padding="lg">
        <div className="grid gap-6 sm:grid-cols-3">
          <Figure label="Balance now">
            <span className="tabular text-[26px] leading-[1.1] font-medium tracking-[-0.02em]">
              {formatEth(BigInt(node.balanceWei), 8)} ETH
            </span>
          </Figure>
          <Figure label="Credited all time">
            <span className="tabular text-[19px]">
              {formatEth(BigInt(node.cumulativeWei), 8)} ETH
            </span>
          </Figure>
          <Figure label="Withdrawn all time">
            <span className="tabular text-[19px]">
              {formatEth(BigInt(node.withdrawnWei), 8)} ETH
            </span>
          </Figure>
        </div>
      </Panel>

      <Panel label="Facts" padding="lg">
        <div className="grid gap-6 sm:grid-cols-2">
          <Figure label="Owner">
            {node.owner ? (
              <span className="flex min-w-0 items-center gap-2">
                <a
                  href={addressUrl(node.owner)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[13.5px] text-ink transition-colors hover:text-orange"
                >
                  {shortAddress(node.owner)}
                </a>
                <CopyButton value={node.owner} label="Copy owner address" />
              </span>
            ) : (
              <span className="text-[14px] text-faint">Not recorded</span>
            )}
          </Figure>
          <Figure label="Deployed">
            <span className="text-[14px] text-muted">
              {node.createdAt ? `${formatDate(node.createdAt)} · ${timeAgo(node.createdAt)}` : "Not recorded"}
            </span>
          </Figure>
          <Figure label="Paid">
            <span className="tabular text-[14px] text-muted">
              {formatEth(BigInt(node.priceWei), 6)} ETH
            </span>
          </Figure>
          <Figure label="Minted by">
            {node.mintTx ? (
              <a
                href={txUrl(node.mintTx)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-[13.5px] text-ink transition-colors hover:text-orange"
              >
                {shortAddress(node.mintTx)}
              </a>
            ) : (
              <span className="text-[14px] text-faint">Not recorded</span>
            )}
          </Figure>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel label="Recent credits" padding="none">
          {credits.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-faint">No data yet</p>
          ) : (
            <ul>
              {credits.map((c, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-4 border-t border-line px-5 py-3 first:border-0"
                >
                  <span className="mono-label">
                    {c.created_at ? timeAgo(c.created_at) : "unknown"}
                  </span>
                  <span className="tabular text-[13.5px]">
                    {formatEth(BigInt(c.amount_wei), 8)} ETH
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel label="Withdrawals" padding="none">
          {withdrawals.length === 0 ? (
            <p className="px-5 py-4 text-[14px] text-faint">Nothing withdrawn yet</p>
          ) : (
            <ul>
              {withdrawals.map((w, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-4 border-t border-line px-5 py-3 first:border-0"
                >
                  <span className="mono-label">
                    {w.observed_at ? timeAgo(w.observed_at) : "unknown"}
                  </span>
                  <span className="flex items-baseline gap-3">
                    {w.tx_hash ? (
                      <a
                        href={txUrl(w.tx_hash)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-mono text-[12.5px] text-faint transition-colors hover:text-orange"
                      >
                        {shortAddress(w.tx_hash)}
                      </a>
                    ) : null}
                    <span className="tabular text-[13.5px]">
                      {formatEth(BigInt(w.amount_wei), 8)} ETH
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="text-[13.5px] leading-[1.6] text-muted">
        History comes from our ledger. The money comes from the contract, and{" "}
        <Link href="/docs/api/node" className="text-ink underline underline-offset-2">
          the API
        </Link>{" "}
        and the explorer will both answer for this node without us.{" "}
        <Link href="/dashboard" className="text-ink underline underline-offset-2">
          Connect a wallet
        </Link>{" "}
        to withdraw from a node you own.
      </p>
    </main>
  );
}
