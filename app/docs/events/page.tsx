import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";
import {RPC_URL} from "@/lib/chain";

export const metadata: Metadata = {
  title: "Events",
  description:
    "Every event emitted by SitowiseFactory, which arguments are indexed, the topic hashes, and how to reconstruct the protocol from logs alone.",
};

export default function EventsPage() {
  return (
    <DocPage
      href="/docs/events"
      lede={
        <>
          The factory emits enough to reconstruct the protocol&rsquo;s entire history from logs
          alone: every node and the payment that bought it, every credit, every payout and every
          configuration change. This page lists all of them.
        </>
      }
    >
      <h2 id="factory">Factory events</h2>
      <CodeBlock label="SitowiseFactory">{`event NodeMinted(uint256 indexed id, address indexed owner, bytes32 paymentRef, uint64 createdAt);
event Credited(uint256 indexed id, uint256 amount, uint256 newBalance);
event Withdrawn(uint256 indexed id, address indexed to, uint256 amount);
event RelayerChanged(address relayer);
event DistributorChanged(address distributor);
event PausedChanged(bool paused);
event MaxPerWalletChanged(uint256 max);
event OwnerChanged(address owner);
event OwnershipOfferStarted(address indexed pendingOwner);
event Funded(address indexed from, uint256 amount);
event Rescued(address indexed to, uint256 amount);`}</CodeBlock>
      <DocTable>
        <thead>
          <tr>
            <th>Event</th>
            <th>Emitted when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>NodeMinted</code>
            </td>
            <td>
              The relayer creates a node. <code>paymentRef</code> is the hash of the transfer that
              paid for it, which is what makes the sale checkable
            </td>
          </tr>
          <tr>
            <td>
              <code>Credited</code>
            </td>
            <td>
              A node&rsquo;s balance goes up, once per node per batch. <code>newBalance</code> is
              the balance after the credit, so a single log is enough to know where a node stands
            </td>
          </tr>
          <tr>
            <td>
              <code>Withdrawn</code>
            </td>
            <td>
              A node owner takes their balance. <code>withdrawAll</code> emits one of these per
              node it sweeps, inside one transaction
            </td>
          </tr>
          <tr>
            <td>
              <code>RelayerChanged</code>, <code>DistributorChanged</code>
            </td>
            <td>
              A role is rotated, and also once each from the constructor with the deploy-time
              values
            </td>
          </tr>
          <tr>
            <td>
              <code>OwnershipOfferStarted</code>, <code>OwnerChanged</code>
            </td>
            <td>
              The two halves of the ownership handover. The first is only an offer; the second is
              the transfer actually taking effect, and it also fires once at deployment
            </td>
          </tr>
          <tr>
            <td>
              <code>PausedChanged</code>, <code>MaxPerWalletChanged</code>
            </td>
            <td>The owner changes a setting. Neither can affect an existing balance</td>
          </tr>
          <tr>
            <td>
              <code>Funded</code>
            </td>
            <td>
              ETH arrives without being attached to a node, through <code>fund()</code> or a plain
              transfer to the contract. This is what a mistaken transfer to the factory produces
            </td>
          </tr>
          <tr>
            <td>
              <code>Rescued</code>
            </td>
            <td>
              The owner takes unattached funds out. It can never exceed{" "}
              <code>freeBalance()</code>, so it can never be a holder&rsquo;s money
            </td>
          </tr>
        </tbody>
      </DocTable>
      <Callout tone="info">
        Two of the eleven fire at deployment rather than in response to anything an operator did
        later: the constructor emits <code>OwnerChanged</code>, <code>RelayerChanged</code> and{" "}
        <code>DistributorChanged</code> so that the initial roles are in the log history and not
        only in storage.
      </Callout>

      <h2 id="reconstruct">Reconstructing the protocol from logs</h2>
      <p>
        These four are enough to rebuild every number this site displays, without trusting the
        site:
      </p>
      <ol>
        <li>
          <code>NodeMinted</code> gives you every node, its owner at mint, and the payment behind
          it.
        </li>
        <li>
          <code>Credited</code> summed per node gives <code>totalReceived</code>; summed overall
          it gives <code>totalDistributed</code>.
        </li>
        <li>
          <code>Withdrawn</code> summed the same way gives <code>totalWithdrawn</code>.
        </li>
        <li>
          Credits minus withdrawals equals <code>outstanding</code>, which the contract also
          reports directly. If the two disagree, one of them is wrong and it is worth knowing
          which.
        </li>
      </ol>
      <p>
        Nodes are not tokens and cannot be transferred, so ownership never changes after{" "}
        <code>NodeMinted</code>. There is no transfer log to follow and none is missing.
      </p>

      <h2 id="hook">Hook events</h2>
      <Callout tone="warn">
        The Uniswap v4 hook is not deployed. Nothing below has ever been emitted on Robinhood
        Chain, and no figure anywhere on this site comes from it. It is documented because it is
        the intended design, not because it is running. See{" "}
        <Link href="/docs/hook-lifecycle">The hook lifecycle</Link>.
      </Callout>
      <CodeBlock label="SitowiseHook, not deployed">{`event SwapAccrued(
    PoolId indexed poolId,
    address indexed currency,
    uint256 amount,
    uint256 cumulative,
    uint16 shareBps
);
event Swept(address indexed currency, address indexed to, uint256 amount);
event FactoryChanged(address indexed oldFactory, address indexed newFactory);
event ShareBpsChanged(uint16 oldShareBps, uint16 newShareBps);
event SweepRecipientChanged(address indexed oldRecipient, address indexed newRecipient);`}</CodeBlock>
      <p>
        <code>SwapAccrued</code> would be the one that matters for anyone checking whether the
        protocol is swap funded. It is designed to fire once per swap that produced a non-zero
        share, so the day it exists, an empty log is a complete answer: if it has never fired, no
        swap has ever paid this hook. Today there is no hook address to query at all, which is the
        same answer arrived at sooner.
      </p>

      <h2 id="topics">Topic hashes</h2>
      <p>
        Topic zero is the keccak hash of the event signature with canonical types. Recompute any
        of these rather than trusting the table:{" "}
        <code>cast keccak &quot;Credited(uint256,uint256,uint256)&quot;</code>.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Event</th>
            <th>Topic 0</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>NodeMinted(uint256,address,bytes32,uint64)</code>
            </td>
            <td>
              <code>0x01f6c872d9a3a5d1c63c69a4edd6004260f7ac9b086be1468e99f0569307bd1c</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>Credited(uint256,uint256,uint256)</code>
            </td>
            <td>
              <code>0x3806c51c015e3f5bafa6a64bacc9ec78aa02f9a208d9d22e52635e923ba00f6e</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>Withdrawn(uint256,address,uint256)</code>
            </td>
            <td>
              <code>0xcf7d23a3cbe4e8b36ff82fd1b05b1b17373dc7804b4ebbd6e2356716ef202372</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>Funded(address,uint256)</code>
            </td>
            <td>
              <code>0x5af8184bef8e4b45eb9f6ed7734d04da38ced226495548f46e0c8ff8d7d9a524</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>Rescued(address,uint256)</code>
            </td>
            <td>
              <code>0x8aec0ce3dadffacf4b7a963e0fed1ff2e6151b4c95d4a65acafa9d1299630402</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>OwnerChanged(address)</code>
            </td>
            <td>
              <code>0xa2ea9883a321a3e97b8266c2b078bfeec6d50c711ed71f874a90d500ae2eaf36</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>RelayerChanged(address)</code>
            </td>
            <td>
              <code>0x88cb58f8479aba47ccd2dcbc41bf94bc01e3f58a877cbe5e7f3bd978d89773ba</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>DistributorChanged(address)</code>
            </td>
            <td>
              <code>0xe37acc13f5ed9d0cc83c2842e093fe5a494d5b8fb5b1db06356b327081832f52</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>PausedChanged(bool)</code>
            </td>
            <td>
              <code>0xd83d5281277e107f080e362699d46082adb74e7dc6a9bccbc87d8ae9533add44</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>MaxPerWalletChanged(uint256)</code>
            </td>
            <td>
              <code>0x00c836a17ed3a6a59dce35376ae3c2777797dc03f39f463153c0fea5b65f0683</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>OwnershipOfferStarted(address)</code>
            </td>
            <td>
              <code>0x23a54ba7a990a65d3d8c17e693e5b066e88154ce314d568de26f02e98ac33dd1</code>
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="reading">Reading logs</h2>
      <CodeBlock label="cast">{`# every node minted, from deployment to now
cast logs --from-block 0 \\
  --address $FACTORY \\
  "NodeMinted(uint256,address,bytes32,uint64)" \\
  --rpc-url ${RPC_URL}

# every credit to one node, using the indexed id as the second topic
cast logs --from-block 0 \\
  --address $FACTORY \\
  "Credited(uint256,uint256,uint256)" \\
  --rpc-url ${RPC_URL}

# payouts, filterable by destination through the second indexed topic
cast logs --from-block 0 \\
  --address $FACTORY \\
  "Withdrawn(uint256,address,uint256)" \\
  --rpc-url ${RPC_URL}`}</CodeBlock>
      <p>
        With viem, the same thing is a typed <code>getLogs</code> against the generated ABI. The
        application ships that ABI, including the custom errors, so a revert is decoded into a
        real reason instead of &quot;execution reverted&quot;. The error list is on{" "}
        <Link href="/docs/factory-interface">Factory interface</Link>.
      </p>
      <p>
        Both <code>NodeMinted</code> and <code>Withdrawn</code> index the node id first and an
        address second, so a wallet&rsquo;s whole history can be filtered on topics without
        downloading every log the contract ever wrote.
      </p>

      <h2 id="not-emitted">What is not in the logs</h2>
      <p>
        The payment that buys a node is not a factory event, because it does not touch the
        factory. It is an ordinary transfer to the payments wallet, visible on the explorer as
        such, and it is tied to the node by its hash appearing as <code>paymentRef</code> in{" "}
        <code>NodeMinted</code>. That is the join between the two halves of the sale. See{" "}
        <Link href="/docs/settlement">Settlement</Link>.
      </p>
      <p>
        The decision behind a credit is not on chain either. Which nodes are credited and by how
        much is computed off chain by the distribution worker; what the chain records is the
        result, with the ETH attached. The per-node history is also available over HTTP from{" "}
        <Link href="/docs/api/node">GET /api/node/:id</Link>, which is a convenience, not the
        source of truth.
      </p>
      <p>
        Sign-ins are not on chain. Signing in produces a message signature, not a transaction, so
        it leaves no trace on the network.
      </p>
    </DocPage>
  );
}
