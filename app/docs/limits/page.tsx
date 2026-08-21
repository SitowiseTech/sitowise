import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {MAX_PER_WALLET_CEILING} from "@/components/docs/protocol";
import {Callout} from "@/components/ui/Callout";
import {MAX_NODES_PER_WALLET, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Limits",
  description:
    "The per-wallet node cap, the ceiling the owner cannot raise it past, the limit on a single credit, and the rate limits on the public API.",
};

export default function LimitsPage() {
  return (
    <DocPage
      href="/docs/limits"
      lede={
        <>
          One wallet may hold at most {MAX_NODES_PER_WALLET} nodes. The cap is in the contract, not
          in the website, and this page explains what it is for, what bounds it, and what it
          honestly cannot do.
        </>
      }
    >
      <h2 id="cap">The cap</h2>
      <CodeBlock label="SitowiseFactory.mintFor">{`if (_owned[to].length >= maxPerWallet) revert WalletLimit();`}</CodeBlock>
      <p>
        The check runs before any state is written, so an over-cap mint costs the relayer gas and
        changes nothing. It is checked against the address the node would be created for, which is
        the address that sent the payment. The current value is a public read:
      </p>
      <CodeBlock label="cast">{`cast call $FACTORY "maxPerWallet()(uint256)"
cast call $FACTORY "MAX_PER_WALLET_CEILING()(uint256)"
cast call $FACTORY "nodeCountOf(address)(uint256)" $WALLET`}</CodeBlock>
      <p>
        The owner can change <code>maxPerWallet</code> with <code>setMaxPerWallet</code>, but only
        within a hard constant the contract carries and no call can move:
      </p>
      <CodeBlock label="SitowiseFactory.setMaxPerWallet">{`function setMaxPerWallet(uint256 v) external onlyOwner {
    if (v == 0 || v > MAX_PER_WALLET_CEILING) revert BadInput();
    maxPerWallet = v;
    emit MaxPerWalletChanged(v);
}`}</CodeBlock>
      <p>
        <code>MAX_PER_WALLET_CEILING</code> is {MAX_PER_WALLET_CEILING}. Raising{" "}
        <code>maxPerWallet</code> affects future mints only; lowering it below what a wallet
        already holds does not remove anything, it simply stops that wallet getting more. Nodes are
        never destroyed by an admin setting, and every change emits{" "}
        <code>MaxPerWalletChanged</code>.
      </p>

      <h2 id="why">Why there is a cap at all</h2>
      <p>Three reasons, in order of how much they actually matter.</p>
      <ol>
        <li>
          <strong>
            <code>withdrawAll</code> has to fit in a block.
          </strong>{" "}
          The sweep loops over every node the caller owns, so the cost of that one transaction
          grows with the cap. That is why the ceiling exists as a constant rather than a setting:
          an unbounded cap could push the sweep past the block gas limit and strand a wallet that
          had accumulated too many nodes. Per-node <code>withdraw</code> always works regardless,
          so even then nothing would be lost, but a holder should never have to discover that.
        </li>
        <li>
          <strong>Distribution cost scales with node count.</strong> Every active node is an entry
          in every round, and during the launch period every node is funded by Sitowise. An
          unbounded number of nodes behind a single wallet turns a launch into a drain.
        </li>
        <li>
          <strong>It is a speed bump.</strong> It raises the cost of trivially accumulating a large
          share of nodes from one address.
        </li>
      </ol>
      <Callout tone="warn">
        A per-wallet cap is not a per-person cap, and pretending otherwise would be dishonest.
        Anyone willing to pay {NODE_PRICE_ETH} ETH per node and use several addresses can hold more
        than {MAX_NODES_PER_WALLET}. The contract has no way to know that two addresses are the
        same person, and Sitowise does not run identity checks. Treat the cap as friction, not as a
        fairness guarantee.
      </Callout>

      <h2 id="other">Other limits</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Limit</th>
            <th>Value</th>
            <th>Enforced by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Nodes per wallet</td>
            <td>{MAX_NODES_PER_WALLET}</td>
            <td>
              The contract, in <code>mintFor</code>
            </td>
          </tr>
          <tr>
            <td>Ceiling on that setting</td>
            <td>{MAX_PER_WALLET_CEILING}, and the owner cannot exceed it</td>
            <td>
              The contract, <code>MAX_PER_WALLET_CEILING</code>
            </td>
          </tr>
          <tr>
            <td>Node price</td>
            <td>Exactly {NODE_PRICE_ETH} ETH per node, no more and no less</td>
            <td>
              The watcher. Payment happens outside the contract, so anything but the exact amount
              is held for review rather than turned into a node.
            </td>
          </tr>
          <tr>
            <td>One payment, one node</td>
            <td>A payment transaction hash can back exactly one node</td>
            <td>
              The contract, <code>paymentRefUsed</code>, reverting <code>RefAlreadyUsed</code>
            </td>
          </tr>
          <tr>
            <td>Single credit amount</td>
            <td>
              Below 2<sup>128</sup> wei, because a node balance is a <code>uint128</code>
            </td>
            <td>
              The contract, in <code>creditBatch</code>, reverting <code>AmountTooLarge</code>
            </td>
          </tr>
          <tr>
            <td>Credit backing</td>
            <td>
              A round&rsquo;s <code>msg.value</code> must equal the sum of its amounts
            </td>
            <td>
              The contract, reverting <code>ValueMismatch</code>
            </td>
          </tr>
          <tr>
            <td>Withdrawal amount</td>
            <td>
              The node&rsquo;s whole balance. There is no partial withdrawal and no amount
              argument.
            </td>
            <td>The contract</td>
          </tr>
          <tr>
            <td>Public API requests</td>
            <td>
              Per IP, per minute: 120 for <code>/api/stats</code> and <code>/api/me</code>, 60 for
              the other public reads, 20 for <code>/api/auth/nonce</code>,{" "}
              <code>/api/auth/verify</code> and <code>/api/nodes/sync</code>
            </td>
            <td>
              The application. See <Link href="/docs/api">the API overview</Link>.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The rate limiter counts in the memory of the process that serves the request, so the
        effective quota is per instance and a cold start resets it. It exists to stop one machine
        scraping the whole ledger, not as a security boundary. Every response carries{" "}
        <code>x-ratelimit-limit</code>, <code>x-ratelimit-remaining</code> and{" "}
        <code>x-ratelimit-reset</code>, so a client never has to guess where it stands.
      </p>

      <h2 id="pause">Pausing</h2>
      <p>
        The owner can pause node creation with <code>setPaused(true)</code>. While paused,{" "}
        <code>mintFor</code> reverts with <code>IsPaused</code> and nothing else changes.
      </p>
      <p>
        Withdrawals have no pause switch. No code path in the contract lets anyone stop an owner
        withdrawing their own balance, which is the asymmetry described on{" "}
        <Link href="/docs/security-model">Security model</Link>. A withdrawal can only fail in ways
        that name themselves: <code>NotNodeOwner</code> if the caller does not own the node,{" "}
        <code>BadInput</code> on a zero destination, <code>NothingToWithdraw</code> when the
        balance is zero, and <code>TransferFailed</code> if the destination rejects the ETH.
      </p>
    </DocPage>
  );
}
