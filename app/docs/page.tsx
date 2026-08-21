import type {Metadata} from "next";
import Link from "next/link";
import {DocFigure, DocPage} from "@/components/docs/DocPage";
import {DocIndex} from "@/components/docs/DocIndex";
import {FlowSchematic} from "@/components/docs/charts/FlowSchematic";
import {StatsStrip} from "@/components/docs/charts/StatsStrip";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID} from "@/lib/chain";
import {MAX_NODES_PER_WALLET, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Overview",
  description:
    "What Sitowise is, what a node is, where rewards come from during the launch period, and how value reaches a wallet.",
};

export default function DocsOverviewPage() {
  return (
    <DocPage
      href="/docs"
      title="Overview"
      lede={
        <>
          Sitowise is a Uniswap v4 hook on Robinhood Chain and a node contract in front of it.
          You deploy a node for {NODE_PRICE_ETH} ETH, value is credited to it, and you withdraw
          that value to any address you choose. These pages describe exactly how that works,
          including where the money comes from today.
        </>
      }
    >
      <StatsStrip />

      <h2 id="what-it-is">What Sitowise is</h2>
      <p>
        Two pieces of software, deployed separately and doing different jobs.
      </p>
      <p>
        <strong>The hook</strong> is a Uniswap v4 contract. Uniswap v4 lets a pool nominate a
        contract that the PoolManager calls at fixed points in a swap. Sitowise implements one of
        those points, <code>afterSwap</code>, and takes a small share of the swap on the way past.
        That code is written, tested and deployable. What it earns depends entirely on how much
        volume flows through pools that are attached to it.
      </p>
      <p>
        <strong>The factory</strong> is the contract that holds your money. It records who owns
        which node, holds each node&rsquo;s balance as real ETH, and lets the owner of a node
        withdraw that balance directly. It knows nothing about swaps. It would work identically
        whether the value credited to nodes came from swap flow, from the operator, or from
        anywhere else.
      </p>

      <h2 id="funding">Where the value comes from</h2>
      <Callout tone="warn" title="Read this before you deploy a node">
        <p>
          A Uniswap v4 pool fixes its hook at the moment it is initialised, and it can never be
          changed afterwards. A hook cannot be bolted onto pools that already exist. Until Sitowise
          creates pools that name the hook and those pools carry real volume, the hook earns
          nothing.
        </p>
        <p>
          During the launch period, the value credited to nodes is funded by Sitowise out of its own
          funds. It is not swap revenue. Once pools are attached to the hook and the protocol
          switches to swap-funded mode, accrual comes from swap flow instead. Sitowise can reduce or
          stop launch-period funding at any time.
        </p>
      </Callout>
      <p>
        Nothing on this site promises a return, a rate, or a payback period, because nobody can
        honestly promise one. What a node accrues is whatever is credited to it, and what is
        credited depends on decisions and volumes that have not happened yet. The{" "}
        <Link href="/docs/risks">risks page</Link> states this and everything else that can go
        wrong, without softening.
      </p>

      <DocFigure
        caption={
          <>
            The path a unit of value takes today, from the transfer that buys a node to the call
            that empties it. The branch entering <code>creditBatch</code> from above is the
            launch-period funding described here, and it is what swap flow would replace once
            pools are attached to the hook.
          </>
        }
      >
        <FlowSchematic />
      </DocFigure>

      <h2 id="node">What a node is</h2>
      <p>
        A node is a numbered record in the factory contract, owned by the address that paid for
        it. Minting one writes four things on chain: the node id, the owner, the timestamp, and
        the hash of the payment that bought it. From then on the record also carries a balance.
      </p>
      <ul>
        <li>
          A node has an id. Ids are sequential from 1 and are displayed zero padded, so the first
          node is <code>#0001</code>.
        </li>
        <li>
          A node has an owner. Only the owner can withdraw from it, and the contract checks{" "}
          <code>msg.sender</code> against that owner on every call.
        </li>
        <li>
          A node has a balance, and that balance is real ETH sitting in the factory against your
          node id. It is not an off-chain figure the operator promises to honour later. Alongside
          it the contract keeps <code>totalReceived</code> and <code>totalWithdrawn</code>, both
          of which only ever increase.
        </li>
        <li>
          A node is not a token. It has no <code>transfer</code>, no marketplace, and no price
          beyond what you paid. See <Link href="/docs/node-model">Node model</Link>.
        </li>
      </ul>
      <p>
        One wallet may hold up to {MAX_NODES_PER_WALLET} nodes. The contract enforces that in{" "}
        <code>mintFor</code>, and the reasoning is on <Link href="/docs/limits">Limits</Link>.
      </p>

      <h2 id="money">How money moves</h2>
      <p>
        Purchase money and payout money never meet, because they never share an address. That
        separation is structural rather than a rule the contract has to enforce.
      </p>
      <ol>
        <li>
          <strong>Purchases go to a wallet, not to a contract.</strong> You buy a node by sending
          a plain {NODE_PRICE_ETH} ETH transfer to the payments wallet, which is an ordinary
          account. A watcher sees that transfer and the relayer calls{" "}
          <code>mintFor(to, paymentRef)</code>, paying the gas, where <code>paymentRef</code> is
          your payment&rsquo;s transaction hash. The factory never receives your purchase money
          and has no price to check, so there is nothing in it that could be paid back out as a
          reward.
        </li>
        <li>
          <strong>Payouts arrive with the ETH attached.</strong> The distributor calls{" "}
          <code>creditBatch(ids, amounts)</code> as a payable call, and the contract rejects it
          unless <code>msg.value</code> equals the sum of <code>amounts</code>. A balance can
          therefore never exist without the ETH behind it. Anyone may also top the contract up
          through <code>fund()</code>, which adds unattached balance and credits no node.
        </li>
      </ol>
      <p>
        Withdrawal needs nothing else. The node owner calls <code>withdraw(id, to)</code> or{" "}
        <code>withdrawAll(to)</code> from their own wallet and the contract sends the whole
        balance. <Link href="/docs/distribution">Distribution</Link> explains what funds a round,
        and <Link href="/docs/settlement">Settlement</Link> follows one payment from transfer to
        node and one balance from credit to wallet.
      </p>

      <h2 id="not">What Sitowise is not</h2>
      <ul>
        <li>
          It is not a staking contract. Nothing is locked, and there is no principal earning a
          rate.
        </li>
        <li>
          It is not a fund. Sitowise does not manage anything on your behalf, and a node is not a
          claim on a pool of assets.
        </li>
        <li>
          It is not a token sale. There is no token. The {NODE_PRICE_ETH} ETH buys a node and is
          not refundable.
        </li>
        <li>
          It is not audited. The code is public and unaudited; see{" "}
          <Link href="/docs/audits">Audits</Link>.
        </li>
      </ul>

      <h2 id="chain">The chain</h2>
      <p>
        Everything runs on Robinhood Chain, chain id {CHAIN_ID}. ETH is the native currency, and
        gas is paid in it. If your wallet has never seen this network, the dashboard offers to add
        it. Full details are on <Link href="/docs/requirements">Requirements</Link>.
      </p>

      <h2 id="next">Where to go next</h2>
      <p>
        If you want to deploy a node, start with{" "}
        <Link href="/docs/quick-start">Quick start</Link>. If you want to understand the mechanism
        before spending anything, read <Link href="/docs/accrual">How accrual works</Link> and then{" "}
        <Link href="/docs/security-model">Security model</Link>.
      </p>
      <DocIndex groups={["Getting started", "Protocol"]} />
    </DocPage>
  );
}
