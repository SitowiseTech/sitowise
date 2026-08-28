import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "GET /api/tiers",
  description:
    "Node tier prices, per-wallet allowances, holding thresholds and accrual multipliers, with which rules the contract enforces and which we do.",
};

export default function ApiTiersPage() {
  return (
    <DocPage
      href="/docs/api/tiers"
      title="GET /api/tiers"
      lede={
        <>
          What a node costs and what the price buys. No parameters, no
          authentication.
        </>
      }
    >
      <h2 id="request">Request</h2>
      <CodeBlock label="Request">{`GET /api/tiers`}</CodeBlock>

      <h2 id="response">Response</h2>
      <CodeBlock label="200 application/json">{`{
  "tiers": [
    {
      "id": "base",
      "label": "Base",
      "priceWei": "20000000000000000",
      "maxPerWallet": 50,
      "holdingWei": "0",
      "holdingToken": null,
      "payoutBps": 10000,
      "onSale": true,
      "enforcedBy": {
        "price": "operator",
        "maxPerWallet": "operator",
        "holding": "operator"
      }
    }
  ]
}`}</CodeBlock>

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
              <code>priceWei</code>
            </td>
            <td>string</td>
            <td>Exact wei a transfer must carry. Anything else is held for review.</td>
          </tr>
          <tr>
            <td>
              <code>maxPerWallet</code>
            </td>
            <td>number</td>
            <td>How many of this tier one wallet may hold.</td>
          </tr>
          <tr>
            <td>
              <code>holdingWei</code>
            </td>
            <td>string</td>
            <td>
              SITOWISE that must be held to buy it. <code>&quot;0&quot;</code> means open to
              anyone.
            </td>
          </tr>
          <tr>
            <td>
              <code>payoutBps</code>
            </td>
            <td>number</td>
            <td>
              Accrual against the base per-credit range. <code>10000</code> is the base rate.
            </td>
          </tr>
          <tr>
            <td>
              <code>enforcedBy</code>
            </td>
            <td>object</td>
            <td>
              Which rules the contract applies and which we do. See below, it is the part
              worth reading.
            </td>
          </tr>
        </tbody>
      </DocTable>

      <Callout tone="warn" title="Only one limit is on chain">
        The contract enforces the total nodes per wallet and nothing else. The per-tier
        allowance, the price and the holding threshold are applied by us before minting, so
        <code>enforcedBy</code> reports them as <code>operator</code>. An API that presented
        all of it as one kind of guarantee would be the most convincing place to get that
        wrong. <Link href="/docs/tiers">Tiers</Link> explains the split.
      </Callout>

      <h2 id="caching">Caching</h2>
      <p>
        Cached for 30 seconds. For what one specific wallet may buy right now, including its
        token balance and remaining allowance, the deploy flow uses a per-address quote
        instead; this route is the same answer for everyone.
      </p>
    </DocPage>
  );
}
