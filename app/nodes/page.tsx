import type {Metadata} from "next";
import Link from "next/link";
import {Panel} from "@/components/ui/Panel";
import {formatDate, formatEth, formatEthLabel, nodeLabel, shortAddress} from "@/lib/format";
import {recentNodes, registryTotals, shapeNodeDetail} from "@/lib/nodes";
import {readFactory} from "@/lib/onchain";
import {nodeInfo} from "@/lib/rpc";
import {TIER_LABEL} from "@/lib/tierLabels";
import {FUNDING_NOTE, SITE} from "@/lib/site";

/**
 * Every node there is.
 *
 * A node page shows one, a holder page shows a wallet's, and the whole set was
 * only reachable by walking ids by hand on the explorer. That is a strange gap
 * for a product whose whole claim is that all of it is readable, so this is the
 * list: newest first, owner and balance on every row, and each id linking to
 * its own page.
 *
 * Read from the ledger and labelled as such. Nothing here is a number the
 * contract would disagree with, and the pages it links to say where to check.
 */

export const dynamic = "force-dynamic";

const PAGE = 100;

export const metadata: Metadata = {
  title: "All nodes",
  description: `Every Sitowise node, newest first, with its owner and what it holds. ${FUNDING_NOTE}`,
  openGraph: {
    title: `All nodes · ${SITE.name}`,
    description: "Every node, newest first, with its owner and what it holds.",
    url: "/nodes",
  },
};

type Search = {searchParams: Promise<{page?: string}>};

function Figure({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="mono-label">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default async function NodesPage({searchParams}: Search) {
  const {page} = await searchParams;
  const current = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const offset = (current - 1) * PAGE;

  const [totals, rows, factory] = await Promise.all([
    registryTotals().catch(() => null),
    recentNodes(PAGE, offset).catch(() => []),
    // The contract keeps these three itself, exactly, so there is no reason to
    // sum them out of the ledger and every reason not to: withdrawals are not
    // indexed there, which made the derived totals silently wrong.
    readFactory(),
  ]);

  const ledger = rows.map(shapeNodeDetail);
  const chain = await Promise.all(
    ledger.map((n) => nodeInfo(BigInt(n.chainNodeId)).catch(() => null)),
  );
  const nodes = ledger.map((n, i) => ({
    ...n,
    balanceWei: (chain[i]?.balanceWei ?? BigInt(n.balanceWei)).toString(),
  }));

  const credited = factory.ok ? factory.data.totalDistributedWei : null;
  const withdrawn = factory.ok ? factory.data.totalWithdrawnWei : null;
  const pages = totals ? Math.max(1, Math.ceil(totals.nodes / PAGE)) : 1;

  return (
    <main className="shell flex flex-col gap-6 py-12 sm:py-16">
      <div className="flex max-w-[62ch] flex-col gap-3">
        <span className="mono-label">Registry</span>
        <h1 className="text-[34px] leading-[1.08] font-medium tracking-[-0.02em] sm:text-[42px]">
          All nodes
        </h1>
        <p className="text-[15px] leading-[1.6] text-muted">
          Every node that exists, newest first. Ids are sequential and never reused, so the
          numbers below are the whole history in order. No wallet needed for any of it.
        </p>
      </div>

      {totals ? (
        <Panel label="Across every node" padding="lg">
          <div className="grid gap-6 sm:grid-cols-4">
            <Figure label="Nodes">
              <span className="tabular text-[26px] leading-[1.1] font-medium tracking-[-0.02em]">
                {totals.nodes}
              </span>
            </Figure>
            <Figure label="Wallets">
              <span className="tabular text-[19px]">{totals.owners}</span>
            </Figure>
            <Figure label="Credited all time">
              <span className="tabular text-[19px]">
                {credited === null ? "Unavailable" : `${formatEth(credited, 6)} ETH`}
              </span>
            </Figure>
            <Figure label="Withdrawn by holders">
              <span className="tabular text-[19px]">
                {withdrawn === null ? "Unavailable" : `${formatEth(withdrawn, 6)} ETH`}
              </span>
            </Figure>
          </div>
        </Panel>
      ) : null}

      <Panel label={`Nodes ${offset + 1} to ${offset + nodes.length}`} padding="none">
        {nodes.length === 0 ? (
          <p className="px-5 py-4 text-[14px] text-faint">Nothing here yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  {["Node", "Tier", "Owner", "Deployed", "Balance"].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`mono-label border-b border-line px-5 py-3 font-normal ${
                        i === 4 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => (
                  <tr key={node.chainNodeId} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <Link
                        href={`/node/${node.chainNodeId}`}
                        className="font-mono text-[13.5px] text-ink transition-colors hover:text-orange"
                      >
                        {nodeLabel(node.chainNodeId)}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-[13.5px] text-muted">
                      {TIER_LABEL[node.tier ?? "base"] ?? "Base"}
                    </td>
                    <td className="px-5 py-3">
                      <OwnerCell owner={node.owner} />
                    </td>
                    <td className="px-5 py-3 text-[13.5px] text-muted">
                      {node.createdAt ? formatDate(node.createdAt) : ""}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-[13.5px]">
                      {formatEthLabel(BigInt(node.balanceWei))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center gap-4">
          {current > 1 ? (
            <Link
              href={`/nodes?page=${current - 1}`}
              className="font-mono text-[13px] text-ink transition-colors hover:text-orange"
            >
              Newer
            </Link>
          ) : null}
          <span className="mono-label">
            Page {current} of {pages}
          </span>
          {current < pages ? (
            <Link
              href={`/nodes?page=${current + 1}`}
              className="font-mono text-[13px] text-ink transition-colors hover:text-orange"
            >
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}

function OwnerCell({owner}: {owner: string | null}) {
  if (!owner) return <span className="text-[13.5px] text-faint">Unknown</span>;
  return (
    <Link
      href={`/holder/${owner}`}
      className="font-mono text-[13px] text-muted transition-colors hover:text-orange"
    >
      {shortAddress(owner)}
    </Link>
  );
}
