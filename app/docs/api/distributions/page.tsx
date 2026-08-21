import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {CreditsChart} from "@/components/docs/charts/CreditsChart";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "GET /api/distributions",
  description:
    "Recent distribution rounds, newest first, including the mode that says whether a round was funded by Sitowise or by swap flow.",
};

export default function ApiDistributionsPage() {
  return (
    <DocPage
      href="/docs/api/distributions"
      title="GET /api/distributions"
      lede={
        <>
          The public run of distribution rounds. Each row carries what it credited, to how many
          nodes, when, and where the money came from.
        </>
      }
    >
      <h2 id="request">Request</h2>
      <CodeBlock label="Request">{`GET /api/distributions
GET /api/distributions?limit=200`}</CodeBlock>
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
              <code>limit</code>
            </td>
            <td>Query</td>
            <td>Rows to return. Default 50, maximum 200. Out of range is a 400.</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="response">Response</h2>
      <CodeBlock label="200 application/json">{`[
  {
    "id": 613,
    "mode": "treasury",
    "totalWei": "768000000000000",
    "nodeCount": 128,
    "createdAt": "2026-08-24T11:02:41.008Z"
  },
  {
    "id": 612,
    "mode": "treasury",
    "totalWei": "742000000000000",
    "nodeCount": 128,
    "createdAt": "2026-08-24T11:00:12.771Z"
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
            <td>
              Round id. Matches <code>distributionId</code> on a credit from{" "}
              <Link href="/docs/api/node">GET /api/node/:id</Link>.
            </td>
          </tr>
          <tr>
            <td>
              <code>mode</code>
            </td>
            <td>string or null</td>
            <td>
              <code>treasury</code> means Sitowise funded this round. <code>swaps</code> means it
              came from hook revenue. The hook is not deployed, so no round carries{" "}
              <code>swaps</code> today.
            </td>
          </tr>
          <tr>
            <td>
              <code>totalWei</code>
            </td>
            <td>string</td>
            <td>Credited across the whole round, in wei</td>
          </tr>
          <tr>
            <td>
              <code>nodeCount</code>
            </td>
            <td>number</td>
            <td>Nodes included in the round</td>
          </tr>
          <tr>
            <td>
              <code>createdAt</code>
            </td>
            <td>string or null</td>
            <td>ISO 8601 UTC, when the round was recorded</td>
          </tr>
        </tbody>
      </DocTable>
      <Callout tone="warn">
        <p>
          The <code>mode</code> field is the honest part of this response and the reason it is
          public per row rather than described once in prose. While it reads{" "}
          <code>treasury</code>, that round&rsquo;s value was funded by Sitowise, not by swap flow,
          and that funding can be reduced or stopped at any time.
        </p>
        <p>
          Do not read this history as a rate. It is a record of what happened, not a projection of
          what will. See <Link href="/docs/risks">Risks</Link>.
        </p>
      </Callout>

      <h2 id="chart">Plotted</h2>
      <p>
        The chart below calls this endpoint and buckets the rounds it gets back, hourly across a
        day or daily across a week.
      </p>
      <DocFigure caption="Live from GET /api/distributions. An empty window says so rather than drawing a line at zero.">
        <CreditsChart />
      </DocFigure>

      <h2 id="paging">Ordering and paging</h2>
      <p>
        Newest first, ordered by creation time then id. There is no cursor and no offset parameter:
        raise <code>limit</code> to widen the window, up to 200. A client that needs the complete
        history should keep its own copy and poll for rows newer than the highest id it has seen.
      </p>
      <p>
        The response is an array, not an envelope, so there is no total count in the payload. The
        protocol-wide totals live on <Link href="/docs/api/stats">GET /api/stats</Link>.
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
              <code>public, max-age=0, s-maxage=10, stale-while-revalidate=30</code>
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
            <td>
              <code>limit</code> is not a whole number between 1 and 200
            </td>
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
      <CodeBlock label="curl and jq">{`# how many recent rounds were funded by Sitowise rather than by swaps
curl -s "https://sitowise.xyz/api/distributions?limit=200" \\
  | jq 'group_by(.mode) | map({mode: .[0].mode, rounds: length})'

# total credited across the rounds returned
curl -s "https://sitowise.xyz/api/distributions?limit=200" \\
  | jq '[.[].totalWei | tonumber] | add'`}</CodeBlock>
      <p>
        As everywhere, <code>tonumber</code> is fine for a glance and wrong for accounting. Use a
        big-integer type when the figure matters.
      </p>
    </DocPage>
  );
}
