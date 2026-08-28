import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {LifecycleDiagram} from "@/components/docs/charts/LifecycleDiagram";
import {Callout} from "@/components/ui/Callout";
import {MAX_NODES_PER_WALLET} from "@/lib/site";

export const metadata: Metadata = {
  title: "Node model",
  description:
    "What a node is on chain: a struct with an owner and a balance, keyed by a sequential id. What it carries, what it deliberately is not, and how ownership is enforced.",
};

export default function NodeModelPage() {
  return (
    <DocPage
      href="/docs/node-model"
      lede={
        <>
          A node is a small, deliberately boring object: a struct in the factory holding an owner,
          a creation time, a balance and two running totals. Most of the questions people ask about
          nodes are answered by what the model leaves out.
        </>
      }
    >
      <h2 id="onchain">What exists on chain</h2>
      <p>Creating a node writes one struct and one array entry, and nothing else.</p>
      <CodeBlock label="SitowiseFactory, the node state">{`struct Node {
    address owner;
    uint64  createdAt;
    uint128 balance;         // withdrawable right now
    uint128 totalReceived;   // credited over the node's whole life
    uint128 totalWithdrawn;
}

mapping(uint256 => Node)      private _node;    // node id -> node
mapping(address => uint256[]) private _owned;   // owner   -> node ids

uint256 public totalNodes;                      // ids are 1-based`}</CodeBlock>
      <p>
        A node id is assigned by <code>++totalNodes</code>, so ids are sequential from 1 and never
        reused. See <Link href="/docs/node-numbering">Node numbering</Link>. There is no accrual
        rate in the struct and no status flag; the three numbers are simply what has been credited,
        what has been taken out, and the difference that is sitting there now.
      </p>
      <p>
        All five fields come back from one call, which is what the explorer&rsquo;s Read Contract
        tab needs:
      </p>
      <CodeBlock label="cast">{`cast call $FACTORY "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" $NODE_ID
# -> owner, createdAt, balance, totalReceived, totalWithdrawn`}</CodeBlock>

      <h2 id="ownership">Ownership</h2>
      <p>
        The owner is the address the node was created for, which is the address that sent the
        payment. Every withdrawal path checks it, and the check is on the node itself, against{" "}
        <code>msg.sender</code>:
      </p>
      <CodeBlock label="SitowiseFactory.withdraw">{`Node storage node = _node[id];
if (node.owner != msg.sender) revert NotNodeOwner();`}</CodeBlock>
      <p>
        Because the check is against the caller, nothing can be presented to the contract on
        somebody else&rsquo;s behalf. There is no signature to forge, no approval to grant and no
        server that could authorise a payout: a withdrawal is a transaction from the owning wallet
        or it does not happen. <code>withdrawAll</code> sweeps only the ids in{" "}
        <code>_owned[msg.sender]</code>, so a batch cannot reach a node the caller does not own
        either. The destination is a separate question and is covered on{" "}
        <Link href="/docs/destination-addresses">Destination addresses</Link>.
      </p>

      <h2 id="state">State and lifecycle</h2>
      <p>
        On chain a node has no state to be in. It exists from the moment <code>mintFor</code>{" "}
        creates it, and there is no retirement, no expiry and no burn function in the contract. The
        active and retired distinction lives in the operator&rsquo;s ledger and controls one thing:
        whether a node is included in new distribution rounds. It cannot affect a withdrawal,
        because the contract does not know it exists.
      </p>
      <DocFigure caption="The states a node can be in. Both live states are ledger states; on chain a node simply exists. Withdrawing does not change state, and retirement does not take credited value with it.">
        <LifecycleDiagram />
      </DocFigure>
      <p>
        The full description of each state is on <Link href="/docs/node-states">Node states</Link>.
      </p>

      <h2 id="is-not">What a node is not</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Not</th>
            <th>Why it matters</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Not a token</td>
            <td>
              No ERC-721, no <code>ownerOf</code>, no <code>transfer</code>, no approvals, no
              marketplace listing. The owner field is written once and there is no function that
              changes it, so a node cannot be sold or moved to another address.
            </td>
          </tr>
          <tr>
            <td>Not a deposit</td>
            <td>
              The price is a purchase, sent to the payments wallet outside the
              contract. It is not held for you, it never enters the factory, and it is not
              refundable.
            </td>
          </tr>
          <tr>
            <td>Not a share of a fund</td>
            <td>
              A node is not a claim on any pool of assets. It receives whatever is credited to it,
              and nothing more.
            </td>
          </tr>
          <tr>
            <td>Not a validator</td>
            <td>
              Nothing is run, staked, or secured by holding one. There is no uptime, no slashing,
              and no hardware.
            </td>
          </tr>
          <tr>
            <td>Not a yield instrument</td>
            <td>
              No rate is promised anywhere, and Sitowise publishes no projection of what a node will
              earn.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <Callout tone="warn">
        Because a node is not transferable, buying one from a third party is not possible and any
        offer to sell you one is a scam. The only way to hold a node is to pay for it yourself from
        the address that will own it.
      </Callout>

      <h2 id="many">Holding several</h2>
      <p>
        A wallet may hold up to {MAX_NODES_PER_WALLET} nodes, enforced in <code>mintFor</code>.
        Nodes held by the same wallet are independent objects: each has its own balance and its own
        pair of running totals. The dashboard sums them for display, and <code>withdrawAll</code>{" "}
        sweeps them in one transaction, but the contract still accounts for each id separately and
        emits one <code>Withdrawn</code> per node.
      </p>
      <CodeBlock label="Reading a wallet's nodes">{`cast call $FACTORY "nodesOf(address)(uint256[])" $WALLET
cast call $FACTORY "nodeCountOf(address)(uint256)" $WALLET
cast call $FACTORY "balanceOfOwner(address)(uint256)" $WALLET`}</CodeBlock>
      <p>
        The same view over HTTP is <Link href="/docs/api/nodes">GET /api/nodes/:address</Link>.
      </p>
    </DocPage>
  );
}
