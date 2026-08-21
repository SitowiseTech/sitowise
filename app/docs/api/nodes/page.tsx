import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {NodeBarsChart} from "@/components/docs/charts/NodeBarsChart";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "GET /api/nodes/:address",
  description:
    "Every node held by one wallet, with balances. Parameters, field types, ordering, and how to verify the same list on chain.",
};

export default function ApiNodesPage() {
  return (
    <DocPage
      href="/docs/api/nodes"
      title="GET /api/nodes/:address"
      lede={
        <>
          Every node a wallet holds, with what each has been credited and what it has already
          withdrawn. Public, because the same list is readable from the contract.
        </>
      }
    >
      <h2 id="request">Request</h2>
      <CodeBlock label="Request">{`GET /api/nodes/0x1234567890abcdef1234567890abcdef12345678`}</CodeBlock>
      <DocTable>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>In</th>
            <th>Rules</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>address</code>
            </td>
            <td>Path</td>
            <td>
              A 20-byte hex address. Case insensitive; matched lower case. An invalid address is a
              400, not an empty list.
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="response">Response</h2>
      <CodeBlock label="200 application/json">{`[
  {
    "id": 12,
    "chainNodeId": "12",
    "createdAt": "2026-08-19T09:14:02.114Z",
    "balanceWei":    "418000000000000",
    "cumulativeWei": "902000000000000",
    "withdrawnWei":  "484000000000000",
    "mintTx": "0xab…",
    "status": "active"
  }
]`}</CodeBlock>
      <DocTable>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>id</code>
            </td>
            <td>number</td>
            <td>Ledger row id. Useful for linking, not for the contract.</td>
          </tr>
          <tr>
            <td>
              <code>chainNodeId</code>
            </td>
            <td>string</td>
            <td>
              The id the contract knows. This is the one to pass to <code>withdraw</code> or{" "}
              <code>nodeInfo</code>. A string because node ids are uint256.
            </td>
          </tr>
          <tr>
            <td>
              <code>createdAt</code>
            </td>
            <td>string or null</td>
            <td>ISO 8601 UTC, when the node was recorded</td>
          </tr>
          <tr>
            <td>
              <code>balanceWei</code>
            </td>
            <td>string</td>
            <td>
              Withdrawable now: <code>cumulativeWei - withdrawnWei</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>cumulativeWei</code>
            </td>
            <td>string</td>
            <td>Ever credited to this node. Never decreases.</td>
          </tr>
          <tr>
            <td>
              <code>withdrawnWei</code>
            </td>
            <td>string</td>
            <td>
              Ever paid out. Moves only after a confirmed transaction, and mirrors{" "}
              <code>totalWithdrawnByNode</code> from <code>nodeInfo(id)</code> on chain.
            </td>
          </tr>
          <tr>
            <td>
              <code>mintTx</code>
            </td>
            <td>string</td>
            <td>Transaction hash the node was minted in</td>
          </tr>
          <tr>
            <td>
              <code>status</code>
            </td>
            <td>string or null</td>
            <td>
              <code>active</code> or <code>retired</code>. See{" "}
              <Link href="/docs/node-states">Node states</Link>.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Nodes are returned oldest first, ordered by chain node id, so ids read in the order they
        were bought. A wallet with no nodes returns <code>[]</code> with a 200. That is not an
        error, and neither is an address that has never touched the protocol.
      </p>

      <h2 id="try">Try it</h2>
      <p>
        Enter any address to plot what this endpoint returns for it. Filled bars are value still on
        the contract, outlined bars are value already withdrawn.
      </p>
      <DocFigure caption="Live from GET /api/nodes/:address. Nothing is drawn until you enter an address.">
        <NodeBarsChart />
      </DocFigure>

      <h2 id="verify">Verifying against the chain</h2>
      <p>
        The ids and every wei figure in this response exist on chain too, and should agree. Where
        they do not, the chain is right.
      </p>
      <CodeBlock label="cast">{`# the same list of ids, straight from the contract
cast call $FACTORY "nodesOf(address)(uint256[])" $ADDRESS

# owner, createdAt, balance, totalReceived, totalWithdrawnByNode for one of them
cast call $FACTORY \\
  "nodeInfo(uint256)(address,uint64,uint256,uint256,uint256)" $CHAIN_NODE_ID`}</CodeBlock>
      <p>
        The third, fourth and fifth values are the same numbers this endpoint calls{" "}
        <code>balanceWei</code>, <code>cumulativeWei</code> and <code>withdrawnWei</code>.
      </p>
      <Callout>
        A node can exist on chain a moment before the ledger records it, so a very fresh mint may be
        missing from this list. The dashboard handles that case explicitly by comparing the two
        sources. If the contract says you own it, you own it.
      </Callout>

      <h2 id="caching">Caching and limits</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Property</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cache-Control</td>
            <td>
              <code>public, max-age=0, s-maxage=5, stale-while-revalidate=15</code>
            </td>
          </tr>
          <tr>
            <td>Rate limit</td>
            <td>60 requests per minute per IP</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="errors">Errors</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Status</th>
            <th>Body</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>400</td>
            <td>
              <code>{`{ "error": "That is not a valid wallet address." }`}</code>
            </td>
            <td>The path segment is not a 20-byte hex address</td>
          </tr>
          <tr>
            <td>429</td>
            <td>
              <code>{`{ "error": "Too many requests…" }`}</code>
            </td>
            <td>Over the per-IP limit</td>
          </tr>
          <tr>
            <td>503</td>
            <td>
              <code>{`{ "error": "This service is not available right now." }`}</code>
            </td>
            <td>The service is misconfigured</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="example">Example</h2>
      <CodeBlock label="curl and jq">{`# total withdrawable across a wallet, in wei
curl -s https://sitowise.xyz/api/nodes/$ADDRESS \\
  | jq '[.[].balanceWei | tonumber] | add'

# just the chain ids, ready to pass to withdraw(id, to) one at a time
curl -s https://sitowise.xyz/api/nodes/$ADDRESS | jq -r '.[].chainNodeId'`}</CodeBlock>
      <p>
        There is no batched withdrawal that takes a list of ids. To empty every node at once, call{" "}
        <code>withdrawAll(to)</code> from the owning wallet and pass no ids at all; the contract
        works out which nodes are yours. See{" "}
        <Link href="/docs/withdrawing">Withdrawing</Link>.
      </p>
      <p>
        Note that <code>tonumber</code> in the first example is fine for a rough total and wrong
        for accounting. Use a big-integer type when the figure matters; see{" "}
        <Link href="/docs/api">the API overview</Link>.
      </p>
    </DocPage>
  );
}
