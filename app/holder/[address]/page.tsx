import type {Metadata} from "next";
import Link from "next/link";
import {notFound} from "next/navigation";
import {isAddress} from "viem";
import {Panel} from "@/components/ui/Panel";
import {CopyButton} from "@/components/ui/CopyButton";
import {addressUrl} from "@/lib/chain";
import {formatDate, formatEth, formatEthLabel, nodeLabel, shortAddress} from "@/lib/format";
import {nodesForOwner, shapeNode} from "@/lib/nodes";
import {TIER_LABEL} from "@/lib/tierLabels";
import {FUNDING_NOTE, SITE} from "@/lib/site";

/**
 * Everything one wallet holds, in public.
 *
 * The node page answers "what is this node". The dashboard answers "what do I
 * own", but only for whoever can sign for the wallet. Nothing answered "what
 * does that address hold" for anybody else, which is the question you have when
 * somebody says they are a holder, or when you want to show that you are one
 * without handing over a screenshot.
 *
 * Read from the ledger, and it says so. The contract stays the authority: the
 * address links out to the explorer, and every node here has its own page and
 * its own on-chain id.
 */

export const dynamic = "force-dynamic";

type Params = {params: Promise<{address: string}>};

export async function generateMetadata({params}: Params): Promise<Metadata> {
  const {address} = await params;
  if (!isAddress(address)) return {title: "Holder"};
  const short = shortAddress(address);
  return {
    title: `${short} · Holder`,
    description: `Every Sitowise node held by ${short}, readable on chain. ${FUNDING_NOTE}`,
    openGraph: {
      title: `${short} · ${SITE.name}`,
      description: `Every node held by ${short}.`,
      url: `/holder/${address}`,
    },
  };
}

function Figure({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="mono-label">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default async function HolderPage({params}: Params) {
  const {address} = await params;
  if (!isAddress(address)) notFound();

  const rows = await nodesForOwner(address).catch(() => []);
  const nodes = rows.map(shapeNode);

  const total = (pick: (n: (typeof nodes)[number]) => string) =>
    nodes.reduce((sum, n) => sum + BigInt(pick(n)), 0n);

  const balance = total((n) => n.balanceWei);
  const credited = total((n) => n.cumulativeWei);
  const withdrawn = total((n) => n.withdrawnWei);

  const byTier = nodes.reduce<Record<string, number>>((acc, n) => {
    const tier = n.tier ?? "base";
    acc[tier] = (acc[tier] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main className="shell flex flex-col gap-6 py-12 sm:py-16">
      <div className="flex flex-col gap-3">
        <span className="mono-label">Holder</span>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-[26px] leading-[1.1] font-medium tracking-[-0.01em] sm:text-[32px]">
            {shortAddress(address, 10, 8)}
          </h1>
          <CopyButton value={address} label="Copy address" />
          <a
            href={addressUrl(address)}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[13px] text-muted transition-colors hover:text-orange"
          >
            Blockscout
          </a>
        </div>
        <p className="max-w-[62ch] text-[15px] leading-[1.6] text-muted">
          {nodes.length === 0
            ? "This wallet holds no Sitowise nodes."
            : "Everything this wallet holds. Each node has its own page, and every figure is readable on chain without this one."}
        </p>
      </div>

      {nodes.length > 0 ? (
        <>
          <Panel label="Held" padding="lg">
            <div className="grid gap-6 sm:grid-cols-4">
              <Figure label="Nodes">
                <span className="tabular text-[26px] leading-[1.1] font-medium tracking-[-0.02em]">
                  {nodes.length}
                </span>
              </Figure>
              <Figure label="Balance now">
                <span className="tabular text-[19px]">{formatEth(balance, 8)} ETH</span>
              </Figure>
              <Figure label="Credited all time">
                <span className="tabular text-[19px]">{formatEth(credited, 8)} ETH</span>
              </Figure>
              <Figure label="Withdrawn all time">
                <span className="tabular text-[19px]">{formatEth(withdrawn, 8)} ETH</span>
              </Figure>
            </div>

            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4">
              {Object.entries(byTier).map(([tier, count]) => (
                <span key={tier} className="mono-label">
                  {TIER_LABEL[tier] ?? tier}: {count}
                </span>
              ))}
            </div>
          </Panel>

          <Panel label="Nodes" padding="none">
            <ul>
              {nodes.map((node) => (
                <li
                  key={node.chainNodeId}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-line px-5 py-3 first:border-0"
                >
                  <span className="flex items-baseline gap-3">
                    <Link
                      href={`/node/${node.chainNodeId}`}
                      className="font-mono text-[14px] text-ink transition-colors hover:text-orange"
                    >
                      NODE {nodeLabel(node.chainNodeId)}
                    </Link>
                    {node.tier && node.tier !== "base" ? (
                      <span className="mono-label rounded-sharp border border-line-dark px-1.5 py-0.5 text-ink">
                        {TIER_LABEL[node.tier] ?? node.tier}
                      </span>
                    ) : null}
                    <span className="mono-label">
                      {node.createdAt ? formatDate(node.createdAt) : ""}
                    </span>
                  </span>
                  <span className="tabular ml-auto text-[13.5px]">
                    {formatEthLabel(BigInt(node.balanceWei))}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      ) : null}

      <p className="max-w-[62ch] text-[13.5px] leading-[1.6] text-muted">
        Totals come from our ledger. The contract is the authority on the money, and{" "}
        <Link href="/docs/api/nodes" className="text-ink underline underline-offset-2">
          the API
        </Link>{" "}
        answers for this address without us.{" "}
        <Link href="/dashboard" className="text-ink underline underline-offset-2">
          Connect this wallet
        </Link>{" "}
        to withdraw from a node you own.
      </p>
    </main>
  );
}
