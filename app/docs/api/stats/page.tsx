import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocFigure, DocPage, DocTable} from "@/components/docs/DocPage";
import {StatsStrip} from "@/components/docs/charts/StatsStrip";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "GET /api/stats",
  description:
    "Protocol totals: nodes, operators, value credited all time and in the last 24 hours. Fields, types, caching and caveats.",
};

export default function ApiStatsPage() {
  return (
    <DocPage
      href="/docs/api/stats"
      title="GET /api/stats"
      lede={
        <>
          Four protocol-wide counters in one object. No parameters, no
          authentication, cached for a few seconds.
        </>
      }
    >
      <h2 id="request">Request</h2>
      <CodeBlock label="Request">{`GET /api/stats`}</CodeBlock>
      <p>Takes no parameters. Anything in the query string is ignored.</p>

      <h2 id="response">Response</h2>
      <CodeBlock label="200 application/json">{`{
  "totalNodes": 128,
  "operators": 43,
  "totalDistributedWei": "4183200000000000",
  "distributions24hWei": "552960000000000"
}`}</CodeBlock>
      <p>
        Those figures are shape, not data. For what the endpoint actually returns right now, see{" "}
        <a href="#live">Live response</a> below or call it yourself.
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
              <code>totalNodes</code>
            </td>
            <td>number</td>
            <td>Active nodes in the ledger. Retired nodes are not counted.</td>
          </tr>
          <tr>
            <td>
              <code>operators</code>
            </td>
            <td>number</td>
            <td>Distinct wallet addresses holding at least one active node.</td>
          </tr>
          <tr>
            <td>
              <code>totalDistributedWei</code>
            </td>
            <td>string</td>
            <td>Total credited across every distribution round, in wei.</td>
          </tr>
          <tr>
            <td>
              <code>distributions24hWei</code>
            </td>
            <td>string</td>
            <td>Credited in rounds recorded in the last 24 hours, in wei.</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="live">Live response</h2>
      <p>
        Read from this endpoint right now. Each cell says &quot;No data yet&quot; rather than
        showing a zero it cannot justify.
      </p>
      <DocFigure caption="Rendered from the same GET /api/stats you can call yourself.">
        <StatsStrip />
      </DocFigure>

      <h2 id="notes">Notes and caveats</h2>
      <ul>
        <li>
          <strong>Distributed is not withdrawn.</strong> These figures count what has been credited
          to nodes, not what holders have taken out. The withdrawn total is on chain as{" "}
          <code>totalWithdrawn()</code>.
        </li>
        <li>
          <strong>Operators is addresses, not people.</strong> One person can hold several
          addresses. See <Link href="/docs/limits">Limits</Link>.
        </li>
        <li>
          <strong>Active only.</strong> Both counts filter to active nodes, so retiring a node
          lowers <code>totalNodes</code> without any node being destroyed.
        </li>
        <li>
          <strong>Rounds, not seconds.</strong> The 24 hour figure covers rounds recorded in that
          window, so it steps rather than sliding smoothly.
        </li>
      </ul>
      <Callout tone="warn">
        These are historical totals, not a forecast. Nothing here should be read as a rate of
        return, and Sitowise publishes no projection of what a node will earn. During the launch
        period the value behind these numbers is funded by Sitowise; see{" "}
        <Link href="/docs/risks">Risks</Link>.
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
              <code>public, max-age=0, s-maxage=10, stale-while-revalidate=30</code>
            </td>
          </tr>
          <tr>
            <td>Server memo</td>
            <td>Up to 10 seconds per instance, so a spike is one query rather than thousands</td>
          </tr>
          <tr>
            <td>Rate limit</td>
            <td>120 requests per minute per IP</td>
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
            <td>429</td>
            <td>
              <code>{`{ "error": "Too many requests. Slow down and try again shortly." }`}</code>
            </td>
            <td>Over the per-IP limit</td>
          </tr>
          <tr>
            <td>503</td>
            <td>
              <code>{`{ "error": "This service is not available right now." }`}</code>
            </td>
            <td>The service is misconfigured, for example no database is reachable</td>
          </tr>
          <tr>
            <td>500</td>
            <td>
              <code>{`{ "error": "Something went wrong. Try again in a moment." }`}</code>
            </td>
            <td>An unexpected failure. Details go to the server log, never to the client.</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="example">Example</h2>
      <CodeBlock label="curl and jq">{`curl -s https://sitowise.xyz/api/stats | jq

# credited in the last day, in ETH, without losing precision
curl -s https://sitowise.xyz/api/stats \\
  | jq -r '.distributions24hWei' \\
  | awk '{printf "%.6f ETH\\n", $1 / 1e18}'`}</CodeBlock>
    </DocPage>
  );
}
