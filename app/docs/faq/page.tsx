import type {Metadata} from "next";
import Link from "next/link";
import {DocPage} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID} from "@/lib/chain";
import {MAX_NODES_PER_WALLET, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Straight answers to the questions that come up most about Sitowise nodes, rewards, withdrawals and the funding source.",
};

export default function FaqPage() {
  return (
    <DocPage
      href="/docs/faq"
      lede={
        <>
          The questions people actually ask, answered without hedging. Where the answer is
          uncomfortable it is still the answer.
        </>
      }
    >
      <h2 id="money">Where does the money come from</h2>

      <h3 id="funding">Is this funded by swap fees right now</h3>
      <p>
        No. Sitowise is a genuine Uniswap v4 hook and the code is written, tested and deployable,
        but a v4 pool fixes its hook when it is initialised and a hook cannot be attached to
        existing pools. Until Sitowise runs pools on the hook and those pools carry volume, the hook
        accrues nothing.
      </p>
      <p>
        During the launch period, the value credited to nodes is funded by Sitowise. That is stated
        on the landing page, in the contract comments, on{" "}
        <Link href="/docs/accrual">How accrual works</Link>, and in the <code>mode</code> field of
        every round returned by{" "}
        <Link href="/docs/api/distributions">GET /api/distributions</Link>.
      </p>

      <h3 id="stop">Can that funding stop</h3>
      <p>
        Yes. It is funded at Sitowise&rsquo;s discretion and can be reduced or stopped at any time,
        with no notice period and no obligation. Nothing in the contract compels anyone to credit
        anything.
      </p>

      <h3 id="return">What return will I make</h3>
      <p>
        Nobody can tell you, and Sitowise does not publish a figure. There is no rate, no yield, no
        APR and no payback period anywhere on this site, because publishing one would be inventing
        it. What a node accrues is whatever is credited to it.
      </p>

      <h2 id="nodes">Nodes</h2>

      <h3 id="what-node">What am I actually buying</h3>
      <p>
        A numbered record in a contract: an id, an owner, a creation time, a balance, and the
        running totals received and withdrawn. The balance is real ETH held by the contract
        against that id. Not a token, not a deposit, not a share of a fund, not a validator. See{" "}
        <Link href="/docs/node-model">Node model</Link>.
      </p>

      <h3 id="sell">Can I sell or transfer a node</h3>
      <p>
        No. There is no transfer function and no marketplace. The only way to hold a node is to pay
        for one from the address that will own it. Any offer to sell you one is a scam.
      </p>

      <h3 id="refund">Can I get my {NODE_PRICE_ETH} ETH back</h3>
      <p>
        No. Your payment is a plain transfer to the payments wallet, which is an ordinary account
        outside the contract. It is not escrowed, not held on your behalf, not refundable, and not
        recoverable by retiring the node. Nothing in the contract can reverse it, because the
        contract never received it.
      </p>

      <h3 id="not-minted">I paid and no node appeared</h3>
      <p>
        Payment and minting are separate steps, so a gap is normal: the watcher waits a couple of
        blocks before picking a transfer up, then the relayer mints against its hash. A node
        usually appears within a minute. If it does not, keep the payment transaction hash, which
        is what the node is minted against, and ask through the account in the site footer. If the
        amount was not exact, the transfer is held for review and sorted out by hand.{" "}
        <Link href="/docs/troubleshooting">Troubleshooting</Link> has the full list.
      </p>

      <h3 id="how-many">How many can I hold</h3>
      <p>
        {MAX_NODES_PER_WALLET} per wallet, enforced in the contract. A determined person can use
        several wallets; the cap is friction, not a fairness guarantee. See{" "}
        <Link href="/docs/limits">Limits</Link>.
      </p>

      <h3 id="lost-wallet">I lost the wallet that owns my node</h3>
      <p>
        The node is lost with it. Ownership cannot be reassigned by anyone, including the contract
        owner, because there is no function that could do it. This is the price of the same
        property that stops anyone taking your node.
      </p>

      <h2 id="payouts">Payouts</h2>

      <h3 id="when-paid">When do I get paid</h3>
      <p>
        Whenever you withdraw. Nothing is pushed to you on a schedule, and there is no interval or
        countdown published anywhere. Value is credited to your node, and it becomes ETH in your
        wallet when you send a withdrawal transaction.
      </p>

      <h3 id="minimum">Is there a minimum withdrawal</h3>
      <p>
        No, beyond having something to withdraw. There is no maximum either, and no amount field:{" "}
        <code>withdraw</code> and <code>withdrawAll</code> take no amount and always move the whole
        balance. The only reason to wait is gas efficiency, and nothing accrues faster for being
        left in place.
      </p>

      <h3 id="withdraw-fee">Does Sitowise take a cut of my withdrawal</h3>
      <p>
        No. The full amount is transferred. You pay the gas for your own transaction, as with any
        transaction you send.
      </p>

      <h3 id="elsewhere">Can I withdraw to a different address</h3>
      <p>
        Yes. <code>to</code> is an argument you pass, and the contract accepts any non-zero
        address. Because you are the one sending the transaction, nobody else gets a say in it and
        nobody else could redirect it. There is also nothing to stop you naming an address you
        cannot spend from, so check it. See{" "}
        <Link href="/docs/destination-addresses">Destination addresses</Link>.
      </p>

      <h3 id="failed">My withdrawal reverted</h3>
      <p>
        Your balance is untouched. Every failure mode reverts the whole transaction, costing gas
        and nothing else. Match the error against the table on{" "}
        <Link href="/docs/troubleshooting">Troubleshooting</Link>.
      </p>

      <h2 id="trust">Trust and safety</h2>

      <h3 id="rug">Can the operator take my balance</h3>
      <p>
        No. <code>rescue</code> is the only way ETH leaves the contract other than a withdrawal,
        and it reverts with <code>ExceedsFree</code> for anything above <code>freeBalance()</code>,
        which is the contract balance minus <code>outstanding</code>, the sum of every node
        balance. Your balance is inside <code>outstanding</code> from the moment it is credited,
        so it is outside what the owner can reach, under every sequence of calls. What the operator
        can and cannot do is listed exhaustively on{" "}
        <Link href="/docs/security-model">Security model</Link>.
      </p>

      <h3 id="pause-withdraw">Can withdrawals be paused</h3>
      <p>
        No. The pause flag is read by <code>mintFor</code> and nowhere else, so pausing stops new
        nodes being created and nothing else. Neither <code>withdraw</code> nor{" "}
        <code>withdrawAll</code> looks at it, and there is no other setting that touches them.
      </p>

      <h3 id="audited">Is it audited</h3>
      <p>
        No. There is no third-party audit and none is scheduled. There are 112 passing tests
        including fuzzed invariants, which is not the same thing. See{" "}
        <Link href="/docs/audits">Audits</Link>.
      </p>

      <h3 id="upgrade">Can the contract be upgraded</h3>
      <p>
        No. There is no proxy and no implementation slot. The code at the address is the code that
        was deployed, and it stays that way.
      </p>

      <h3 id="disappear">What if Sitowise disappears</h3>
      <p>
        The contract keeps working, and every node owner can still call <code>withdraw</code> for
        whatever balance they already hold. Withdrawal needs nothing from Sitowise: no server, no
        signature, no permission, not even this website. The contract is verified on the explorer,
        so the call can be made from its Read and Write tabs or with <code>cast</code>.
      </p>
      <p>
        What stops is new credits. Only the distributor can call <code>creditBatch</code>, so if
        Sitowise stops operating, nothing new is ever credited to any node. Balances already on
        your nodes are unaffected. That dependency is stated as a risk on{" "}
        <Link href="/docs/risks">Risks</Link>.
      </p>

      <h2 id="practical">Practical</h2>

      <h3 id="network">Which network is this</h3>
      <p>
        Robinhood Chain, chain id {CHAIN_ID}, and nowhere else. There is no testnet deployment and
        no deployment on any other chain.
      </p>

      <h3 id="token">Is there a token</h3>
      <p>
        No. There is no token, no ticker, no presale and no allowlist. A node is bought with ETH
        and pays out in ETH.
      </p>

      <h3 id="seed">Will anyone ask for my seed phrase</h3>
      <Callout tone="warn">
        Never. Sitowise asks for exactly three things: one message signature to sign in, one plain
        ETH transfer to the payments wallet to buy a node, and one withdrawal transaction per
        payout. Anyone asking for a seed phrase, a private key, or a payment to &quot;unlock&quot;
        a balance is attempting to rob you. The payments wallet is printed on{" "}
        <Link href="/docs/addresses">Addresses</Link>; take the address from there, never from a
        message.
      </Callout>

      <h3 id="verify">How do I check any of this myself</h3>
      <p>
        Everything that matters for money is on chain and readable without this website. Start with{" "}
        <Link href="/docs/addresses">Addresses</Link>, then{" "}
        <Link href="/docs/factory-interface">Factory interface</Link>. If a claim on this site
        cannot be checked against the contract, treat it with suspicion.
      </p>
    </DocPage>
  );
}
