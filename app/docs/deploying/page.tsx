import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {CHAIN_ID} from "@/lib/chain";
import {MAX_NODES_PER_WALLET, NODE_PRICE_ETH} from "@/lib/site";

export const metadata: Metadata = {
  title: "Deploying a node",
  description:
    "What happens when you buy a Sitowise node: the transfer you send, the mintFor call the relayer makes against it, and every way that call can be rejected.",
};

export default function DeployingPage() {
  return (
    <DocPage
      href="/docs/deploying"
      lede={
        <>
          Deploying a node starts with a plain {NODE_PRICE_ETH} ETH transfer to the payments
          wallet. You never call the contract yourself. A watcher sees the transfer and the relayer
          creates the node against it, which is why the sale can be checked in the explorer.
        </>
      }
    >
      <h2 id="steps">What you do</h2>
      <ol>
        <li>
          Open the <Link href="/dashboard">dashboard</Link> and connect the wallet that will own the
          node. Ownership is fixed when the node is created and cannot be transferred, so connect
          the address you actually want.
        </li>
        <li>
          Sign the sign-in message. No gas, no transaction, no approval to move funds. It creates
          the session the dashboard reads your nodes with.
        </li>
        <li>
          Press <strong>Deploy a node</strong> and confirm the transfer. Your wallet sends exactly{" "}
          {NODE_PRICE_ETH} ETH to the payments wallet. That address is an ordinary account, not the
          factory and not a contract, so the transaction carries no calldata and does nothing but
          move value.
        </li>
        <li>
          Wait. The watcher reads the block, records your transaction, and the relayer calls{" "}
          <code>mintFor</code> and pays that gas. The dashboard shows the node once that call
          confirms.
        </li>
      </ol>
      <p>
        The wallet-side walkthrough, with what each prompt looks like, is on{" "}
        <Link href="/docs/quick-start">Quick start</Link>.
      </p>
      <Callout tone="warn">
        Send the exact amount, to the exact address. Only a transfer of exactly {NODE_PRICE_ETH}{" "}
        ETH is queued for minting; anything under or over is held for a human to look at rather
        than turned into a node automatically. Both values come from{" "}
        <code>GET /api/deploy-quote</code>, which is what the deploy flow fills the transfer in
        from. Read them at the moment you pay rather than from a saved copy: the contract has no{" "}
        <code>price()</code> and never sees the payment, so that endpoint is the only source that
        cannot go stale, and it answers 503 rather than quoting a zero address if the payments
        wallet is not configured.
      </Callout>

      <h2 id="onchain">What the contract does</h2>
      <p>
        <code>mintFor</code> is short, and reading it end to end takes less time than reading a
        description of it.
      </p>
      <CodeBlock label="SitowiseFactory.mintFor">{`function mintFor(address to, bytes32 paymentRef) external onlyRelayer returns (uint256 id) {
    if (paused) revert IsPaused();
    if (to == address(0)) revert BadInput();
    if (paymentRef == bytes32(0)) revert BadInput();
    if (paymentRefUsed[paymentRef]) revert RefAlreadyUsed();
    if (_owned[to].length >= maxPerWallet) revert WalletLimit();

    paymentRefUsed[paymentRef] = true;

    id = ++totalNodes;
    _node[id] =
        Node({owner: to, createdAt: uint64(block.timestamp), balance: 0, totalReceived: 0, totalWithdrawn: 0});
    _owned[to].push(id);
    emit NodeMinted(id, to, paymentRef, uint64(block.timestamp));
}`}</CodeBlock>
      <ul>
        <li>
          <strong>The relayer calls it, not you.</strong> <code>onlyRelayer</code> means the only
          address that can create a node is the operator&rsquo;s relayer key. It pays the gas for
          the call, and it can do nothing else: crediting and withdrawing are separate roles.
        </li>
        <li>
          <strong>No money moves through it.</strong> The function is not <code>payable</code>.
          Your {NODE_PRICE_ETH} ETH went to the payments wallet and never touches the factory, so
          there is nothing to forward and nothing to refund here.
        </li>
        <li>
          <strong>
            <code>paymentRef</code> is your payment transaction hash.
          </strong>{" "}
          It goes into the <code>NodeMinted</code> event and into the <code>paymentRefUsed</code>{" "}
          mapping. One payment therefore backs exactly one node: a second attempt against the same
          hash reverts with <code>RefAlreadyUsed</code>. Without that mapping the reference would
          prove nothing, because one payment could back unlimited nodes.
        </li>
        <li>
          <strong>Sequential id.</strong> <code>++totalNodes</code> assigns the next id. Ids start
          at 1 and are never reused, so <code>totalNodes</code> is also the count of nodes ever
          created. See <Link href="/docs/node-numbering">Node numbering</Link>.
        </li>
        <li>
          <strong>The node starts empty.</strong> <code>balance</code>, <code>totalReceived</code>{" "}
          and <code>totalWithdrawn</code> are all zero. Value arrives later, in a distribution
          round.
        </li>
      </ul>

      <h2 id="failures">Why a mint can fail</h2>
      <p>
        These are reverts on the relayer&rsquo;s call, not on a transaction of yours. Your transfer
        has already happened by then, so a failure here means the payment sits in the queue and is
        retried, and is raised for a human if it keeps failing.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Error</th>
            <th>Meaning</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>WalletLimit()</code>
            </td>
            <td>The paying wallet already holds {MAX_NODES_PER_WALLET} nodes.</td>
            <td>
              Do not pay again from that address; use a different wallet. See{" "}
              <Link href="/docs/limits">Limits</Link>.
            </td>
          </tr>
          <tr>
            <td>
              <code>IsPaused()</code>
            </td>
            <td>Node creation is paused by the operator.</td>
            <td>
              Wait. Pausing blocks new nodes only, and can never block a withdrawal of value
              already credited.
            </td>
          </tr>
          <tr>
            <td>
              <code>RefAlreadyUsed()</code>
            </td>
            <td>A node already exists against that payment transaction hash.</td>
            <td>
              Nothing. It means your node was created and the mint was attempted twice, so check
              the dashboard before paying again.
            </td>
          </tr>
          <tr>
            <td>
              <code>BadInput()</code>
            </td>
            <td>A zero destination address or a zero payment reference was passed.</td>
            <td>Report it. It means a misconfigured relayer, not anything you did.</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        All four are custom errors and none of them carry arguments, so a wallet or an explorer
        that decodes them shows the name rather than &quot;execution reverted&quot;. The full list
        is on <Link href="/docs/factory-interface">Factory interface</Link>.
      </p>

      <h2 id="verify">Checking your own purchase</h2>
      <p>
        Two things tie your money to your node, and both are public. First the payment transaction
        itself: your address, the payments wallet, exactly {NODE_PRICE_ETH} ETH. Then the{" "}
        <code>NodeMinted</code> log on the factory carrying that same transaction hash as{" "}
        <code>paymentRef</code>, with your address as the owner.
      </p>
      <CodeBlock label="cast">{`# was a node minted against this payment?
cast call $FACTORY "paymentRefUsed(bytes32)(bool)" $PAYMENT_TX_HASH

# which node ids the address holds, and one of them in full
cast call $FACTORY "nodesOf(address)(uint256[])" $YOUR_ADDRESS
cast call $FACTORY "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" $NODE_ID`}</CodeBlock>
      <p>
        If <code>paymentRefUsed</code> reads true and a <code>NodeMinted</code> log names your
        address, the sale is complete regardless of what any interface shows. How to find the log
        yourself is on <Link href="/docs/events">Events</Link>.
      </p>

      <h2 id="direct">Buying without the website</h2>
      <p>
        The dashboard is a convenience. A payment is a plain transfer, so it can be sent from
        anywhere, including a wallet&rsquo;s send screen or the command line. Read the destination
        and the exact wei from <code>GET /api/deploy-quote</code> immediately before you send;
        they are the server&rsquo;s values, not constants in this page, and a transfer against an
        out-of-date pair lands in manual review instead of becoming a node.
      </p>
      <CodeBlock label="cast">{`# the address to pay and the exact wei to send
curl -s https://sitowise.xyz/api/deploy-quote

cast send $PAYMENT_ADDRESS \\
  --value ${NODE_PRICE_ETH}ether \\
  --rpc-url $RPC_URL \\
  --private-key $YOUR_KEY`}</CodeBlock>
      <Callout>
        A node bought from the command line is identical to one bought through the site. The
        relayer mints for whichever address sent the payment, and the dashboard reads nodes from
        the chain, so it appears there once the mint confirms and your session covers that address.
      </Callout>

      <h2 id="after">After the node exists</h2>
      <p>
        Your node exists on chain {CHAIN_ID} and is included in future distribution rounds. Credits
        arrive as real ETH on its balance; what the numbers mean is on{" "}
        <Link href="/docs/balances">Balances</Link>, and turning a balance into ETH in your wallet
        is one call you make yourself, described on{" "}
        <Link href="/docs/withdrawing">Withdrawing</Link>.
      </p>
      <p>
        The {NODE_PRICE_ETH} ETH is spent. It went to a wallet outside the contract, it is not held
        on your behalf, not refundable, and not recoverable. That is stated again, in context, on{" "}
        <Link href="/docs/risks">Risks</Link>.
      </p>
    </DocPage>
  );
}
