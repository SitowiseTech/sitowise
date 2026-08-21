import type {Metadata} from "next";
import Link from "next/link";
import type {ReactNode} from "react";
import {DocPage} from "@/components/docs/DocPage";
import {DEFAULT_HOOK_SHARE_BPS} from "@/components/docs/protocol";
import {CHAIN_ID} from "@/lib/chain";
import {NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Glossary",
  description:
    "Every term Sitowise's documentation uses, defined once: hook, pool, node, payment reference, credit batch, outstanding, free balance and the rest.",
};

type Entry = {term: string; body: ReactNode};

/**
 * Definitions are ordered as a reader meets them, not alphabetically. A
 * glossary sorted by first letter puts "rescue" before "outstanding" and forces
 * anyone reading it end to end to jump backwards.
 */
const GROUPS: Array<{title: string; id: string; entries: Entry[]}> = [
  {
    title: "The protocol",
    id: "protocol",
    entries: [
      {
        term: "Hook",
        body: (
          <>
            A contract that a Uniswap v4 pool calls at fixed points during an operation. Sitowise
            implements one of those points, <code>afterSwap</code>. A hook&rsquo;s address encodes
            which points it implements, so it has to be deployed to a mined address. See{" "}
            <Link href="/docs/hook-lifecycle">The hook lifecycle</Link>.
          </>
        ),
      },
      {
        term: "PoolManager",
        body: (
          <>
            The single Uniswap v4 contract that holds every pool and calls hooks. It is the only
            address permitted to call Sitowise&rsquo;s <code>afterSwap</code>.
          </>
        ),
      },
      {
        term: "Pool",
        body: (
          <>
            A trading pair inside the PoolManager, identified by a <code>PoolKey</code>. The key
            includes the hook, which is why a pool&rsquo;s hook is fixed at initialisation and can
            never be changed.
          </>
        ),
      },
      {
        term: "Specified and unspecified side",
        body: (
          <>
            A swap fixes one side and lets the other float. Selling exactly one token specifies the
            input; buying exactly one token specifies the output. Uniswap v4 only lets an{" "}
            <code>afterSwap</code> hook move the unspecified side, which is where Sitowise&rsquo;s
            share is charged.
          </>
        ),
      },
      {
        term: "Share, shareBps",
        body: (
          <>
            The fraction of the unspecified side the hook keeps, in basis points. The hook is
            being written to {DEFAULT_HOOK_SHARE_BPS} bps with a hard cap of 500 bps. Nothing on
            chain enforces either figure today, because the hook is not deployed.
          </>
        ),
      },
      {
        term: "Accrual",
        body: (
          <>
            Value taken by the hook out of a swap. There is none: the hook is not deployed and no
            pool names it, so nothing on this site comes from swap flow. What funds rewards today
            is on <Link href="/docs/accrual">How accrual works</Link>.
          </>
        ),
      },
      {
        term: "Sweep",
        body: (
          <>
            Moving accrued value off the hook and into the factory, where it can be credited to
            nodes. The hook is not deployed, so nothing is being swept today; see{" "}
            <Link href="/docs/hook-lifecycle">The hook lifecycle</Link>.
          </>
        ),
      },
    ],
  },
  {
    title: "Nodes and the ledger",
    id: "nodes",
    entries: [
      {
        term: "Node",
        body: (
          <>
            A numbered record in the factory contract, bought for {NODE_PRICE_ETH} ETH. It carries
            an id, an owner, a creation time, a balance and two running totals, and nothing else.
            Not transferable, not a token. See <Link href="/docs/node-model">Node model</Link>.
          </>
        ),
      },
      {
        term: "Payment reference, paymentRef",
        body: (
          <>
            The transaction hash of the plain ETH transfer that paid for a node. It is passed to{" "}
            <code>mintFor</code>, emitted in <code>NodeMinted</code>, and recorded in{" "}
            <code>paymentRefUsed</code>, so one payment backs exactly one node and a second attempt
            reverts with <code>RefAlreadyUsed</code>. It is what lets anyone match a node to the
            payment that bought it in the explorer. See{" "}
            <Link href="/docs/settlement">Settlement</Link>.
          </>
        ),
      },
      {
        term: "Payments wallet",
        body: (
          <>
            The ordinary account that receives node payments. It is not the factory and not any
            contract, so purchase money never enters the contract and can never be paid out as a
            reward. It is the only Sitowise address you ever send ETH to; it is printed on{" "}
            <Link href="/docs/addresses">Addresses</Link>.
          </>
        ),
      },
      {
        term: "Relayer",
        body: (
          <>
            The operator key allowed to call <code>mintFor</code>, and nothing else. It watches for
            payments and creates the node, paying that gas itself. It holds no user funds and
            cannot touch a node balance; a leak costs unauthorised mints and gas.
          </>
        ),
      },
      {
        term: "Distributor",
        body: (
          <>
            The operator key allowed to call <code>creditBatch</code>, and nothing else. Because
            that call is payable and must carry the ETH being credited, this key holds the payout
            float. It cannot mint, cannot change any setting, and cannot withdraw from a node.
          </>
        ),
      },
      {
        term: "Chain node id",
        body: (
          <>
            The id the contract knows, sequential from 1 and never reused. Displayed zero padded as{" "}
            <code>#0001</code>. This is the id every money path uses.
          </>
        ),
      },
      {
        term: "Ledger row id",
        body: (
          <>
            The operator database&rsquo;s own identifier for a node. Returned alongside the chain
            id, and never accepted where money moves. See{" "}
            <Link href="/docs/node-numbering">Node numbering</Link>.
          </>
        ),
      },
      {
        term: "Active and retired",
        body: (
          <>
            Whether a node is included in new distribution rounds. The state lives off chain and
            never affects your ability to withdraw what has already been credited.
          </>
        ),
      },
      {
        term: "Credit",
        body: (
          <>
            Value assigned to one node in one round. A credit is an on-chain event: it raises the
            node&rsquo;s balance and arrives with the ETH that backs it in the same transaction.
          </>
        ),
      },
      {
        term: "Credit batch, creditBatch",
        body: (
          <>
            <code>creditBatch(ids, amounts)</code>, the payable call the distributor uses to credit
            many nodes at once. The contract reverts with <code>ValueMismatch</code> unless{" "}
            <code>msg.value</code> equals the sum of <code>amounts</code>, which is why a balance
            can never exist without the ETH behind it. See{" "}
            <Link href="/docs/distribution">Distribution</Link>.
          </>
        ),
      },
      {
        term: "Round, distribution",
        body: (
          <>
            One pass that credits every active node, settled on chain as a single{" "}
            <code>creditBatch</code> transaction. Each round records where its money came from. See{" "}
            <Link href="/docs/distribution">Distribution</Link>.
          </>
        ),
      },
      {
        term: "Mode: treasury or swaps",
        body: (
          <>
            The name for where a round&rsquo;s money came from, recorded per round and exposed in
            the public API. <code>treasury</code> means Sitowise funded the round out of its own
            funds. <code>swaps</code> means it came from hook accrual. It is a label on the source
            of the ETH, not a contract: there is no treasury contract, and the mode changes nothing
            about how the credit reaches your node.
          </>
        ),
      },
      {
        term: "Total received",
        body: (
          <>
            Everything ever credited to a node, held on chain as the{" "}
            <code>totalReceived</code> field of <code>nodeInfo</code>. It only ever increases, and
            withdrawing does not reduce it.
          </>
        ),
      },
      {
        term: "Total withdrawn",
        body: (
          <>
            Everything ever paid out of a node, held on chain as the{" "}
            <code>totalWithdrawn</code> field of <code>nodeInfo</code>. Also only ever increases,
            and advanced before any ETH moves.
          </>
        ),
      },
      {
        term: "Balance, withdrawable",
        body: (
          <>
            What a node holds right now, stored on chain as ETH the contract is actually sitting
            on. It is not a figure derived from a ledger elsewhere. A withdrawal takes all of it
            and sets it to zero.
          </>
        ),
      },
    ],
  },
  {
    title: "Payouts",
    id: "payouts",
    entries: [
      {
        term: "Withdraw, withdrawAll",
        body: (
          <>
            <code>withdraw(id, to)</code> empties one node; <code>withdrawAll(to)</code> sweeps
            every node the caller owns. Both are called by the node owner from their own wallet,
            neither takes an amount, and neither can be paused. See{" "}
            <Link href="/docs/withdrawing">Withdrawing</Link>.
          </>
        ),
      },
      {
        term: "Outstanding",
        body: (
          <>
            <code>outstanding</code>, the sum of every node balance: what the contract owes
            holders. It rises with each credit and falls with each withdrawal, and the contract is
            written so it always matches the balances behind it. A fuzzed invariant checks that.
          </>
        ),
      },
      {
        term: "Free balance",
        body: (
          <>
            <code>freeBalance()</code>, the contract&rsquo;s ETH minus <code>outstanding</code>:
            money the contract holds that belongs to no node. It is what arrives through{" "}
            <code>fund()</code> or a bare transfer, and it is the only money the owner can ever
            remove.
          </>
        ),
      },
      {
        term: "Rescue",
        body: (
          <>
            <code>rescue(to, amount)</code>, the owner-only call for taking unattached funds back
            out. Anything above <code>freeBalance()</code> reverts with <code>ExceedsFree</code>,
            so it cannot reach a node balance under any sequence of calls. This is the holders&rsquo;
            guarantee; see <Link href="/docs/security-model">Security model</Link>.
          </>
        ),
      },
      {
        term: "Solvent",
        body: (
          <>
            <code>isSolvent()</code> returns whether the contract&rsquo;s ETH still covers{" "}
            <code>outstanding</code>. Anyone can read it, without an account and without this site.
          </>
        ),
      },
    ],
  },
  {
    title: "General",
    id: "general",
    entries: [
      {
        term: "Wei",
        body: (
          <>
            The smallest unit of ETH, one quintillionth. All accounting is in wei, and every API
            field ending in <code>Wei</code> is a decimal string for that reason.
          </>
        ),
      },
      {
        term: "EIP-6963",
        body: (
          <>
            The standard by which wallet extensions announce themselves individually. It is how the
            dashboard lists wallets under their real names instead of guessing from an injected
            flag.
          </>
        ),
      },
      {
        term: "Robinhood Chain",
        body: <>The network everything here runs on, chain id {CHAIN_ID}. ETH is the native currency.</>,
      },
      {
        term: "CREATE2",
        body: (
          <>
            Deployment at an address derived from a salt, which is what makes it possible to hit
            the specific address a v4 hook needs.
          </>
        ),
      },
    ],
  },
];

export default function GlossaryPage() {
  return (
    <DocPage
      href="/docs/glossary"
      lede={
        <>
          Every term these pages use, defined once and in the order a reader meets them rather than
          alphabetically.
        </>
      }
    >
      {GROUPS.map((group) => (
        <section key={group.id}>
          <h2 id={group.id}>{group.title}</h2>
          {group.entries.map((entry) => (
            <p key={entry.term}>
              <strong>{entry.term}.</strong> {entry.body}
            </p>
          ))}
        </section>
      ))}
    </DocPage>
  );
}
