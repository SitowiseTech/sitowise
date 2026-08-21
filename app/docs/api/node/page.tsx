import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "GET /api/node/:id",
  description:
    "One node in full: owner, balances, its credit history and its withdrawal history, with both id spaces echoed back.",
};

export default function ApiNodePage() {
  return (
    <DocPage
      href="/docs/api/node"
      title="GET /api/node/:id"
      lede={
        <>
          Everything the ledger holds about one node, including the individual credits it has
          received and every withdrawal made against it.
        </>
      }
    >
      <h2 id="request">Request</h2>
      <CodeBlock label="Request">{`GET /api/node/12
GET /api/node/12?limit=200`}</CodeBlock>
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
              <code>id</code>
            </td>
            <td>Path</td>
            <td>
              Either the chain node id or the ledger row id. Both are echoed back, so the answer
              always says which node you got.
            </td>
          </tr>
          <tr>
            <td>
              <code>limit</code>
            </td>
            <td>Query</td>
            <td>
              How many credits and withdrawals to return. Default 50, maximum 200. Applies to each
              list separately.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <Callout>
        Accepting either id is safe here because this is a read with no side effects. Anything that
        writes takes the chain node id only, never the ledger row id: that is true of{" "}
        <code>POST /api/nodes/sync</code>, and it is true of the contract, which has never heard of
        a row id. Passing a row id to <code>withdraw</code> would name a different node. See{" "}
        <Link href="/docs/node-numbering">Node numbering</Link>.
      </Callout>

      <h2 id="response">Response</h2>
      <CodeBlock label="200 application/json">{`{
  "id": 12,
  "chainNodeId": "12",
  "owner": "0x1234567890abcdef1234567890abcdef12345678",
  "createdAt": "2026-08-19T09:14:02.114Z",
  "priceWei": "20000000000000000",
  "balanceWei":    "418000000000000",
  "cumulativeWei": "902000000000000",
  "withdrawnWei":  "484000000000000",
  "mintTx": "0xab…",
  "status": "active",

  "credits": [
    {
      "id": 8814,
      "distributionId": 613,
      "amountWei": "6120000000",
      "createdAt": "2026-08-24T11:02:41.008Z"
    }
  ],

  "withdrawals": [
    {
      "id": 41,
      "amountWei": "484000000000000",
      "cumulativeSignedWei": "484000000000000",
      "toAddress": "0x1234567890abcdef1234567890abcdef12345678",
      "deadline": 1756041600,
      "txHash": "0xcd…",
      "status": "sent",
      "createdAt": "2026-08-22T18:31:09.552Z",
      "confirmedAt": "2026-08-22T18:31:41.310Z"
    }
  ]
}`}</CodeBlock>

      <h3 id="node-fields">Node fields</h3>
      <p>
        The same fields as <Link href="/docs/api/nodes">GET /api/nodes/:address</Link>, plus two:
      </p>
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
              <code>owner</code>
            </td>
            <td>string or null</td>
            <td>
              Owner as recorded in the ledger, lower case. The contract is authoritative through
              the first value <code>nodeInfo(id)</code> returns.
            </td>
          </tr>
          <tr>
            <td>
              <code>priceWei</code>
            </td>
            <td>string</td>
            <td>What was actually paid for this node, in wei, at the time it was minted</td>
          </tr>
        </tbody>
      </DocTable>

      <h3 id="credit-fields">Credit fields</h3>
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
            <td>Credit row id</td>
          </tr>
          <tr>
            <td>
              <code>distributionId</code>
            </td>
            <td>number</td>
            <td>
              The round this credit belongs to. Cross-reference with{" "}
              <Link href="/docs/api/distributions">GET /api/distributions</Link> to see the round
              total and its funding mode.
            </td>
          </tr>
          <tr>
            <td>
              <code>amountWei</code>
            </td>
            <td>string</td>
            <td>Credited to this node in that round</td>
          </tr>
          <tr>
            <td>
              <code>createdAt</code>
            </td>
            <td>string or null</td>
            <td>ISO 8601 UTC</td>
          </tr>
        </tbody>
      </DocTable>

      <h3 id="withdrawal-fields">Withdrawal fields</h3>
      <p>
        This list is the ledger&rsquo;s record of withdrawals against the node. It is history, not
        permission: the server plays no part in a withdrawal, which is a call the owner&rsquo;s own
        wallet makes to the factory. Two of the columns below are leftovers from an older design
        and no longer carry a meaning; they are documented so nobody reads one as something it is
        not.
      </p>
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
            <td>Withdrawal row id in the ledger. It has no meaning on chain.</td>
          </tr>
          <tr>
            <td>
              <code>amountWei</code>
            </td>
            <td>string</td>
            <td>Paid out by this withdrawal</td>
          </tr>
          <tr>
            <td>
              <code>cumulativeSignedWei</code>
            </td>
            <td>string</td>
            <td>
              A leftover column. No server signs anything that permits a withdrawal, so this
              carries no current meaning. Do not build against it.
            </td>
          </tr>
          <tr>
            <td>
              <code>toAddress</code>
            </td>
            <td>string or null</td>
            <td>
              Where the ETH was sent, which is the <code>to</code> argument the owner passed to{" "}
              <code>withdraw</code>. Not necessarily the owner&rsquo;s own address.
            </td>
          </tr>
          <tr>
            <td>
              <code>deadline</code>
            </td>
            <td>number</td>
            <td>
              A leftover column. Withdrawals have no expiry and no time limit of any kind. Ignore
              it.
            </td>
          </tr>
          <tr>
            <td>
              <code>txHash</code>
            </td>
            <td>string or null</td>
            <td>The transaction the withdrawal happened in, once one is known</td>
          </tr>
          <tr>
            <td>
              <code>status</code>
            </td>
            <td>string or null</td>
            <td>
              One of <code>signed</code>, <code>sent</code> or <code>failed</code>, the three the
              column allows. <code>sent</code> is a withdrawal that went through and{" "}
              <code>failed</code> one that reverted.
            </td>
          </tr>
          <tr>
            <td>
              <code>createdAt</code>
            </td>
            <td>string or null</td>
            <td>ISO 8601 UTC, when the row was written</td>
          </tr>
          <tr>
            <td>
              <code>confirmedAt</code>
            </td>
            <td>string or null</td>
            <td>When the receipt was seen. Null until then.</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        A <code>failed</code> row is a transaction that reverted. It costs the sender gas and
        leaves the node&rsquo;s balance exactly where it was, because a revert undoes everything in
        the call. What the contract can revert with is on{" "}
        <Link href="/docs/factory-interface">Factory interface</Link>.
      </p>
      <Callout>
        The authoritative withdrawal history is on chain, in the <code>Withdrawn</code> event and
        in the <code>totalWithdrawnByNode</code> figure <code>nodeInfo(id)</code> returns. This
        list can lag it, and it can be missing rows for a withdrawal the ledger has not observed
        yet. Where the two disagree, the chain is right. See{" "}
        <Link href="/docs/events">Events</Link>.
      </Callout>

      <h2 id="ordering">Ordering and paging</h2>
      <p>
        Both lists are newest first, ordered by creation time then id. There is no cursor; use{" "}
        <code>limit</code> to widen the window, up to 200 rows per list. For a full history of a
        long-lived node, read the chain logs instead; see{" "}
        <Link href="/docs/events">Events</Link>.
      </p>

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
              <code>{`{ "error": "…" }`}</code>
            </td>
            <td>The id is not a positive whole number, or the limit is out of range</td>
          </tr>
          <tr>
            <td>404</td>
            <td>
              <code>{`{ "error": "No node with that id." }`}</code>
            </td>
            <td>No node matches under either id space</td>
          </tr>
          <tr>
            <td>429</td>
            <td>
              <code>{`{ "error": "Too many requests…" }`}</code>
            </td>
            <td>Over the per-IP limit</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="example">Example</h2>
      <CodeBlock label="curl and jq">{`# what this node has been credited, round by round
curl -s https://sitowise.xyz/api/node/12 \\
  | jq -r '.credits[] | "\\(.createdAt)  \\(.amountWei)"'

# every destination this node has ever paid out to
curl -s https://sitowise.xyz/api/node/12 \\
  | jq -r '.withdrawals[] | select(.status == "sent") | .toAddress' \\
  | sort -u`}</CodeBlock>
    </DocPage>
  );
}
