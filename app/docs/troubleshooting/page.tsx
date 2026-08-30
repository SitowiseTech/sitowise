import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID, CHAIN_ID_HEX, EXPLORER_URL, RPC_URL} from "@/lib/chain";
import {MAX_NODES_PER_WALLET, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Troubleshooting",
  description:
    "Stuck transactions, the wrong network, a wallet that opens the wrong extension, missing gas, payments that did not become a node, and withdrawals that reverted.",
};

export default function TroubleshootingPage() {
  return (
    <DocPage
      href="/docs/troubleshooting"
      lede={
        <>
          Things that go wrong, what each one actually means, and the shortest way out. Almost none
          of them put funds at risk, and this page says which ones do.
        </>
      }
    >
      <h2 id="wallet">The wallet did not open</h2>
      <p>
        Usually a popup blocker, an extension that is locked, or a second wallet that has claimed
        the connection. Try in order:
      </p>
      <ol>
        <li>Unlock the extension and press the button again.</li>
        <li>Allow popups for this site.</li>
        <li>
          Disable the wallets you are not using for a moment. Several extensions announce
          themselves under the same name, and the one that answers is not always the one you meant.
        </li>
        <li>Reload the page. The connection is re-established on load.</li>
      </ol>
      <Callout>
        The dashboard lists wallets through EIP-6963, which asks each extension for its own
        identity rather than guessing from an injected flag. If the wallet you expect is missing
        from the list, that extension is not announcing itself, and reinstalling or updating it
        usually fixes the announcement.
      </Callout>

      <h2 id="network">Wrong network</h2>
      <p>
        Sitowise only exists on Robinhood Chain, chain id {CHAIN_ID} (<code>{CHAIN_ID_HEX}</code>).
        A wallet on another network cannot see your nodes, and any transaction it sends goes to a
        different chain entirely. A payment sent on another chain does not reach the payments
        wallet here and cannot mint anything.
      </p>
      <p>
        The dashboard offers to switch and, if needed, to add the network. If the prompt does not
        appear, add it manually with the parameters on{" "}
        <Link href="/docs/requirements">Requirements</Link>. If your wallet already has an entry
        for {CHAIN_ID} pointing at a stale RPC, correct the URL to{" "}
        <code>{RPC_URL}</code> rather than adding a second entry.
      </p>

      <h2 id="pending">The transaction is pending forever</h2>
      <p>
        A transaction that has been broadcast but not mined is usually underpriced or stuck behind
        an earlier one from the same address. Nonces are sequential: nothing after a stuck
        transaction can confirm until it does.
      </p>
      <ol>
        <li>
          Find it on the explorer at <code>{EXPLORER_URL}</code> by pasting your address.
        </li>
        <li>
          If your wallet offers &quot;speed up&quot;, use it. That resends the same nonce with a
          higher fee.
        </li>
        <li>
          Otherwise cancel it, which sends a zero-value transaction to yourself with the same
          nonce, then retry.
        </li>
      </ol>
      <p>
        A pending payment has not left your wallet and has not created a node. A pending withdrawal
        has not moved any balance. Neither is lost while it waits.
      </p>

      <h2 id="missing">The payment confirmed but no node appeared</h2>
      <p>
        Buying a node is a plain transfer to the payments wallet, not a contract call. A watcher
        reads blocks for transfers to that wallet, and once one is recorded the relayer calls{" "}
        <code>mintFor</code> and pays the gas for it. So there is always a short gap between your
        transfer confirming and the node existing.
      </p>
      <p>
        <strong>
          Start at <Link href="/check">Check a payment</Link>.
        </strong>{" "}
        Paste the transaction you paid with and it answers directly: the node it created, or
        that it is queued, or that it is held and why. It needs no wallet, and if the payment
        was never recorded on our side, checking it there records it. Everything below is for
        working it out yourself instead.
      </p>
      <p>Work through it in this order:</p>
      <ol>
        <li>
          Confirm the transfer itself confirmed, rather than still being pending or having
          reverted.
        </li>
        <li>
          Confirm the amount was exactly one of the{" "}
          <Link href="/docs/tiers">tier prices</Link>. Anything else is recorded and parked for
          a human rather than minted, because deciding between a refund and a top-up is not
          something the software should guess.
        </li>
        <li>
          For a gated tier, confirm the paying wallet held the required SITOWISE at the moment
          the payment was processed, not only when you clicked. A payment that fails that check
          is held rather than minted, and <Link href="/check">Check a payment</Link> says so in
          as many words.
        </li>
        <li>
          Confirm it went to the payments wallet the deploy flow showed you, and not to the factory
          contract. ETH sent straight to the factory is accepted as unattached contract funds, no
          node is created, and the watcher never sees it. That one needs the operator to sort out.
        </li>
        <li>
          Look for the mint on the explorer. The node is created by{" "}
          <code>NodeMinted(id, owner, paymentRef, createdAt)</code>, where{" "}
          <code>paymentRef</code> is the hash of your payment transaction. That is how a node is
          tied back to the payment that bought it, and it is the field to search on.
        </li>
        <li>Read the chain directly. If this returns your id, the node exists.</li>
      </ol>
      <CodeBlock label="cast">{`cast call $FACTORY "nodesOf(address)(uint256[])" $YOUR_ADDRESS \\
  --rpc-url ${RPC_URL}`}</CodeBlock>
      <p>
        Indexing runs behind the chain, so a node can exist for a short while before the dashboard
        lists it. If the chain says you own it, you own it, whatever any interface shows.
      </p>

      <h2 id="reverts">The transaction reverted</h2>
      <p>
        Withdrawals are your own transactions, so their errors land in your wallet. Mints are the
        relayer&rsquo;s transaction, so those errors show up as a node that never appeared; they
        are listed here because the reason is worth knowing.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Error</th>
            <th>What happened</th>
            <th>Fix</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>NotNodeOwner</code>
            </td>
            <td>The wallet sending the withdrawal does not own that node</td>
            <td>
              Switch to the wallet that bought it. Check with{" "}
              <code>nodesOf(address)</code>.
            </td>
          </tr>
          <tr>
            <td>
              <code>NothingToWithdraw</code>
            </td>
            <td>
              The balance is zero, either because nothing has been credited yet or because a
              previous <code>withdrawAll</code> already swept it
            </td>
            <td>
              Read <code>nodeInfo(id)</code>. Nothing was lost; there was nothing to send.
            </td>
          </tr>
          <tr>
            <td>
              <code>BadInput</code>
            </td>
            <td>The destination passed to a withdrawal was the zero address</td>
            <td>Pass a real address</td>
          </tr>
          <tr>
            <td>
              <code>TransferFailed</code>
            </td>
            <td>The destination rejected the ETH</td>
            <td>
              Withdraw to an address that can receive plain transfers, see{" "}
              <Link href="/docs/destination-addresses">Destination addresses</Link>
            </td>
          </tr>
          <tr>
            <td>
              <code>WalletLimit</code>
            </td>
            <td>The wallet already holds {MAX_NODES_PER_WALLET} nodes, the per-wallet cap</td>
            <td>
              Use another wallet, see <Link href="/docs/limits">Limits</Link>
            </td>
          </tr>
          <tr>
            <td>
              <code>IsPaused</code>
            </td>
            <td>Minting is paused, so the relayer cannot create new nodes</td>
            <td>Wait. Withdrawals are never blocked by pausing.</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        A revert undoes everything in the transaction except the gas. Nothing is half applied, and
        no balance is left in a strange state. The full list of errors is on{" "}
        <Link href="/docs/factory-interface">Factory interface</Link>.
      </p>

      <h2 id="gas">Not enough gas</h2>
      <p>
        Gas is paid in ETH on chain {CHAIN_ID}, separately from the node price. Two common
        situations:
      </p>
      <ul>
        <li>
          <strong>Spent everything on the node.</strong> A wallet holding exactly{" "}
          {NODE_PRICE_ETH} ETH cannot buy one, because the transfer costs the price plus gas.
        </li>
        <li>
          <strong>Cannot afford to withdraw.</strong> The withdrawal is sent by you, so you need
          gas even though the ETH being sent comes from the contract. It is around 55,000 gas for
          one node, more for a sweep across several, so keep a small balance for it. Figures are on{" "}
          <Link href="/docs/withdrawing">Withdrawing</Link>.
        </li>
      </ul>

      <h2 id="balance">A balance looks wrong</h2>
      <p>
        Read the node straight from the chain. One call returns the balance, everything ever
        credited and everything ever withdrawn, and those three are the only figures involved.
      </p>
      <CodeBlock label="cast">{`cast call $FACTORY "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" $NODE_ID`}</CodeBlock>
      <p>
        If the balance reads zero after a sweep, that is <code>withdrawAll</code> having done its
        job: it empties every node the wallet owns, not just the one you were looking at. Display
        truncates to six decimals, so very small balances can read as zero while being non-zero
        underneath; a withdrawal still takes the exact figure. See{" "}
        <Link href="/docs/balances">Balances</Link>.
      </p>

      <h2 id="session">Signed in, then signed out again</h2>
      <p>
        The session is a cookie tied to the address that signed. It ends when it expires, when you
        switch accounts in the wallet, or when cookies are cleared. Sign in again; nothing about
        your nodes or your balances depends on the session, which only decides what the dashboard
        will show you. Withdrawing does not use it at all.
      </p>

      <Callout tone="warn">
        Nobody from Sitowise will ever ask for your seed phrase or private key, ask you to send ETH
        to an address to &quot;unlock&quot; a balance, or offer to sell you a node. Nodes cannot be
        transferred, so any such offer is a scam.
      </Callout>
    </DocPage>
  );
}
