import type {Metadata} from "next";
import Link from "next/link";
import type {ReactNode} from "react";
import {DocPage} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "What shipped in Sitowise and when, including every change that affects node holders.",
};

type Entry = {
  date: string;
  id: string;
  title: string;
  items: ReactNode[];
};

/**
 * Newest first. Nothing here is backdated: the log starts at the first public
 * release, because inventing a history of releases that nobody could have used
 * would be the first dishonest thing in these docs.
 */
const ENTRIES: Entry[] = [
  {
    date: "26 August 2026",
    id: "2026-08-26",
    title: "Balances moved on chain",
    items: [
      <>
        <strong>What this means if you hold a node.</strong> Nobody needs Sitowise for you to be
        paid. Your balance is ETH the contract is holding against your node id, and{" "}
        <code>withdraw(id, to)</code> or <code>withdrawAll(to)</code> is a call you make yourself,
        from your own wallet, with no server, no signature and no permission involved. If this
        site and everyone behind it vanished tomorrow, the call would still work against the
        verified contract.
      </>,
      <>
        <strong>SitowiseFactory redeployed with on-chain balances.</strong> Each node now carries a
        balance, a total received and a total withdrawn in contract storage.{" "}
        <code>outstanding</code> is the sum of every node balance, and <code>rescue</code> is
        bounded by <code>freeBalance()</code>, so the owner cannot reach holder money under any
        sequence of calls. Verified on the explorer; the address is on{" "}
        <Link href="/docs/addresses">Addresses</Link>.
      </>,
      <>
        <strong>The EIP-712 voucher path and the treasury contract were removed.</strong> Balances
        used to be kept off chain and settled against a signature from a signer key. Vouchers
        existed to save gas, and gas on this chain is around 0.03 gwei, so the complexity bought
        nothing. There is no signer key any more, no voucher, no deadline, no allowance and no
        treasury contract. The <code>/api/withdraw/prepare</code> and{" "}
        <code>/api/withdraw/confirm</code> endpoints were deleted with them; there are no withdraw
        endpoints, because withdrawing needs no API at all.
      </>,
      <>
        <strong>Payment moved to a plain transfer.</strong> A node is bought by sending the price
        to the payments wallet, an ordinary account outside the contract. A watcher sees the
        transfer and the relayer calls <code>mintFor(to, paymentRef)</code> and pays that gas,
        where <code>paymentRef</code> is the payment transaction hash. It is recorded in{" "}
        <code>paymentRefUsed</code>, so one payment backs exactly one node and anyone can match a
        node to the payment that bought it. See <Link href="/docs/settlement">Settlement</Link>.
      </>,
      <>
        <strong>Credits arrive with their money attached.</strong> Rounds are settled by{" "}
        <code>creditBatch(ids, amounts)</code>, a payable call that reverts unless{" "}
        <code>msg.value</code> equals the sum of <code>amounts</code>. A node balance can no longer
        exist without the ETH behind it.
      </>,
      <>
        <strong>Three roles, separated.</strong> The owner is the cold deployer key and may change
        roles, pause new mints, set the per-wallet cap and rescue unattached funds. The relayer may
        only mint. The distributor may only credit. None of them can withdraw from a node.
        Ownership transfer is two-step, so a typo cannot brick the admin surface.
      </>,
      <>
        <strong>Pausing no longer touches withdrawals.</strong> The pause flag is read by{" "}
        <code>mintFor</code> and nowhere else. There is no setting that can stop you taking your
        balance out.
      </>,
    ],
  },
  {
    date: "24 August 2026",
    id: "2026-08-24",
    title: "First public release",
    items: [
      <>
        <strong>Nodes, the dashboard and the ledger went live.</strong> Buying a node, listing what
        a wallet holds, and following what each node has been credited. The settlement design that
        shipped with it was replaced two days later by the entry above.
      </>,
      <>
        <strong>Launch-period funding stated on every relevant surface.</strong> The landing page,
        these docs, the contract comments and the <code>mode</code> field on every distribution
        round all say where the money is coming from. Rounds funded by Sitowise are recorded as{" "}
        <code>treasury</code>, not dressed up as swap revenue.
      </>,
      <>
        <strong>The hook was documented as a plan, not a product.</strong> It is not deployed, no
        pool names it, and no figure on this site comes from swap flow. That has been said plainly
        from the first day rather than added later; see{" "}
        <Link href="/docs/hook-lifecycle">The hook lifecycle</Link>.
      </>,
      <>
        <strong>Public API.</strong> <code>/api/stats</code>, <code>/api/nodes/:address</code>,{" "}
        <code>/api/node/:id</code> and <code>/api/distributions</code>, rate limited per IP, with
        one error envelope. See <Link href="/docs/api">the API overview</Link>.
      </>,
      <>
        <strong>Documentation published.</strong> The full set, covering the protocol, nodes,
        payouts, the contract interface and the API, including{" "}
        <Link href="/docs/risks">Risks</Link> and <Link href="/docs/audits">Audits</Link>.
      </>,
    ],
  },
];

export default function ChangelogPage() {
  return (
    <DocPage
      href="/docs/changelog"
      lede={
        <>
          What has shipped, when, and what it changed for holders. Anything that affects your
          position is recorded here rather than announced once and forgotten.
        </>
      }
    >
      {ENTRIES.map((entry) => (
        <section key={entry.id}>
          <h2 id={entry.id} data-toc-label={entry.date}>
            {entry.date}
            <span className="mono-label ml-3 align-middle">{entry.title}</span>
          </h2>
          <ul>
            {entry.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ))}

      <h2 id="recorded">What gets recorded here</h2>
      <p>
        Every change that alters your position or the rules you deployed under, whether or not it
        is convenient to publish:
      </p>
      <ul>
        <li>
          A change to the node price, which lives off chain, or to the payments wallet you send it
          to.
        </li>
        <li>
          A change to the per-wallet cap, the relayer or the distributor, all of which emit an
          event on chain anyway.
        </li>
        <li>Minting being paused or unpaused. Withdrawals cannot be paused.</li>
        <li>
          The switch from <code>treasury</code> to <code>swaps</code> mode, which is the single
          change these docs point at most often.
        </li>
        <li>
          Any reduction, pause or end of launch-period funding. That is the change holders most
          need to know about, so it goes here first.
        </li>
        <li>A contract deployment, including the address it landed at.</li>
        <li>
          Breaking API changes. Additive fields are not breaking; ignore fields you do not
          recognise.
        </li>
      </ul>
      <Callout>
        On-chain configuration changes emit events regardless of what any page says. Reading the
        chain directly is the way to check that this log is complete; see{" "}
        <Link href="/docs/events">Events</Link>.
      </Callout>
    </DocPage>
  );
}
