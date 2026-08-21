import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID, CHAIN_ID_HEX, RPC_URL} from "@/lib/chain";
import {MAX_NODES_PER_WALLET, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Quick start",
  description:
    "Connect a wallet on Robinhood Chain, deploy a node for 0.02 ETH, watch it accrue, and withdraw to any address.",
};

export default function QuickStartPage() {
  return (
    <DocPage
      href="/docs/quick-start"
      lede={
        <>
          Four steps, two transactions, and one signature. This page walks the whole path and says
          what happens on chain at each point, so you can tell a slow network from a stuck
          transaction.
        </>
      }
    >
      <h2 id="before">Before you start</h2>
      <p>
        You need a browser wallet holding ETH on Robinhood Chain, chain id {CHAIN_ID}. Bridged ETH
        from another network does not count until it has actually arrived on {CHAIN_ID}. Budget
        slightly more than the node price, because you pay gas on top of it.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>What</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Network</td>
            <td>
              Robinhood Chain, chain id <code>{CHAIN_ID}</code> (<code>{CHAIN_ID_HEX}</code>)
            </td>
          </tr>
          <tr>
            <td>RPC</td>
            <td>
              <code>{RPC_URL}</code>
            </td>
          </tr>
          <tr>
            <td>Node price</td>
            <td>{NODE_PRICE_ETH} ETH, exact, plus gas</td>
          </tr>
          <tr>
            <td>Per wallet</td>
            <td>{MAX_NODES_PER_WALLET} nodes maximum</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Full detail, including how to add the network by hand, is on{" "}
        <Link href="/docs/requirements">Requirements</Link>.
      </p>

      <h2 id="connect">1. Connect and sign in</h2>
      <p>
        Open the <Link href="/dashboard">dashboard</Link> and connect your wallet. You will be
        asked to sign a plain text message. That signature proves you control the address and
        creates a session cookie. It is not a transaction, it costs no gas, and it grants no
        permission to move funds.
      </p>
      <p>
        If your wallet is on another network, the dashboard offers to switch, and to add Robinhood
        Chain if the wallet has never seen it. Approve both prompts and you land back on the same
        screen.
      </p>
      <Callout>
        Several extensions inject themselves as the same browser object, so a button labelled with
        one wallet can open another. The dashboard discovers wallets through EIP-6963 and lists
        each one under its real name. Pick the one you meant.
      </Callout>

      <h2 id="deploy">2. Deploy a node</h2>
      <p>
        Press <strong>Deploy a node</strong>. There is no contract call here. Your wallet opens a
        plain ETH transfer of exactly {NODE_PRICE_ETH} ETH to the payments wallet, which is an
        ordinary account and not the factory. The modal shows the address and the amount before
        you sign, and both are re-read from the server immediately beforehand so a price change
        cannot turn into a transfer that no longer matches.
      </p>
      <CodeBlock label="What the wallet is signing">{`to:     payments wallet   // shown in the modal, not the factory
value:  ${NODE_PRICE_ETH} ETH
data:   none              // a plain transfer
chain:  ${CHAIN_ID}`}</CodeBlock>
      <p>Paying and minting are two separate moments, in this order:</p>
      <ol>
        <li>Your transfer confirms. The dashboard keeps the payment hash on screen throughout.</li>
        <li>
          A watcher reads the payments wallet and picks the transfer up, once it is a couple of
          blocks behind the head.
        </li>
        <li>
          The relayer calls <code>mintFor(you, paymentRef)</code> and pays that gas.{" "}
          <code>paymentRef</code> is your payment&rsquo;s transaction hash, so the sale is
          checkable in the explorer, and the contract records it in <code>paymentRefUsed</code> so
          one payment can back exactly one node.
        </li>
        <li>
          The node appears in your list, usually within a minute. The id is assigned by the
          contract, not by the website.
        </li>
      </ol>
      <Callout tone="warn" title="Pay from a wallet you control">
        The node is minted to whichever address the ETH came from. Paying out of an exchange
        withdrawal mints the node to the exchange, and nobody can withdraw from it or move it to
        you afterwards. Send from the wallet you signed in with.
      </Callout>
      <p>
        The amount has to be exact. A transfer for anything else is held for manual review rather
        than minting a node. If the node has not appeared by the time the modal stops waiting, it
        is queued rather than lost: keep the payment hash.
      </p>

      <h2 id="watch">3. Watch it accrue</h2>
      <p>
        Value is credited to nodes in rounds. A round is one <code>creditBatch</code> transaction
        that sends the ETH and assigns it to node balances in the same call, so the money is on
        your node the moment the round confirms. The dashboard shows balance, total received and
        total withdrawn per node, and the balance is what you can withdraw right now.
      </p>
      <p>
        There is no schedule published anywhere, and the size of a round is not fixed. During the
        launch period rewards are funded by Sitowise and can be reduced or stopped. Read{" "}
        <Link href="/docs/distribution">Distribution</Link> for the mechanics and{" "}
        <Link href="/docs/risks">Risks</Link> for what that means for you.
      </p>

      <h2 id="withdraw">4. Withdraw</h2>
      <p>
        One transaction, sent by you, from the wallet that owns the node. There is no server in
        this path: nothing to prepare, nothing to request, nothing that expires, and no signature
        from anyone else.
      </p>
      <ol>
        <li>
          Press <strong>Withdraw</strong> on one node, or <strong>Withdraw all</strong> for the
          lot. The dashboard reads the balance straight from the contract and shows you that
          figure rather than one carried in from its own database.
        </li>
        <li>
          Check the destination, which defaults to the connected wallet, and confirm. Your wallet
          calls <code>withdraw(id, to)</code> for a single node, or <code>withdrawAll(to)</code>,
          which sweeps every node you own and pays the combined total in one transfer.
        </li>
      </ol>
      <p>
        There is no amount field, because neither function takes an amount. A withdrawal always
        moves the node&rsquo;s whole balance and leaves it at zero. What actually moved is read
        back out of the <code>Withdrawn</code> events in your own receipt, so a credit that lands
        between the read and the transaction is paid out too.
      </p>
      <p>
        Gas for that transaction is yours, and it is the only gas you pay. The value goes to the
        address you named, which does not have to be the wallet that signed in. See{" "}
        <Link href="/docs/destination-addresses">Destination addresses</Link>, and{" "}
        <Link href="/docs/withdrawing">Withdrawing</Link> for every way the call can fail.
      </p>
      <Callout>
        Pausing the contract stops new mints. It never stops a withdrawal, and there is no setting
        that can. If the dashboard is down you can call either function against the verified
        contract on the explorer, or with <code>cast</code>, and get the same result.
      </Callout>

      <h2 id="verify">Verifying it yourself</h2>
      <p>
        Everything above is visible on chain. Two reads against the factory tell you the truth
        without trusting this site.
      </p>
      <CodeBlock label="cast, from the contracts directory">{`# every node id held by an address
cast call $FACTORY "nodesOf(address)(uint256[])" $YOUR_ADDRESS \\
  --rpc-url ${RPC_URL}

# owner, createdAt, balance, totalReceived, totalWithdrawn for node 1
cast call $FACTORY "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" 1 \\
  --rpc-url ${RPC_URL}`}</CodeBlock>
      <p>
        The public API returns the same figures over HTTP. Start at{" "}
        <Link href="/docs/api">the API overview</Link>.
      </p>
    </DocPage>
  );
}
