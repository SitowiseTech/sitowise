import type {Metadata} from "next";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocCards} from "@/components/docs/DocIndex";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {DOC_NAV} from "@/components/docs/nav";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "API overview",
  description:
    "Base URL, response shapes, wei encoding, caching, rate limits and the error envelope used by every Sitowise endpoint.",
};

const API_GROUP = DOC_NAV.find((group) => group.title === "API");

export default function ApiOverviewPage() {
  return (
    <DocPage
      href="/docs/api"
      title="API overview"
      lede={
        <>
          A small read-only HTTP API over the same ledger the dashboard uses. No key, no signup,
          and no versioning games: six public endpoints, JSON in and out, rate limited by IP.
        </>
      }
    >
      <h2 id="base">Base URL and conventions</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Item</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Base path</td>
            <td>
              <code>/api</code> on this origin
            </td>
          </tr>
          <tr>
            <td>Methods</td>
            <td>
              <code>GET</code> for everything public
            </td>
          </tr>
          <tr>
            <td>Content type</td>
            <td>
              <code>application/json</code>
            </td>
          </tr>
          <tr>
            <td>Errors</td>
            <td>
              <code>{`{ "error": "human readable" }`}</code> with a correct status
            </td>
          </tr>
          <tr>
            <td>Authentication</td>
            <td>
              None for public endpoints. See{" "}
              <a href="/docs/api/authentication">Authentication</a>.
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="endpoints">The public endpoints</h2>
      <CodeBlock label="Public surface" copyable={false}>{`GET /api/stats
GET /api/nodes/:address
GET /api/node/:id?limit=50
GET /api/distributions?limit=50
GET /api/deploy-quote
GET /api/price`}</CodeBlock>
      {API_GROUP ? <DocCards items={API_GROUP.items.slice(2, 6)} /> : null}
      <p>
        <code>/api/deploy-quote</code> answers{" "}
        <code>{`{ priceWei, paymentAddress, chainId }`}</code>, and it is the only honest source for
        the first two. Buying a node is a plain ETH transfer to a payments wallet, so the contract
        never sees the payment: it has no <code>price()</code> to read and no address to point at,
        and both figures live in the server&rsquo;s environment instead. Quote them from here
        rather than hardcoding either. A transfer sent to the wrong address, or carrying the wrong
        amount, does not become a node on its own.
      </p>
      <p>
        <code>/api/price</code> has no page of its own because there is nothing to it: it proxies a
        spot ETH quote so the dashboard can print a dollar figure beside an ETH one, and answers{" "}
        <code>{`{ "usd": null }`}</code> with a 200 when no quote is available. There is no
        fallback price, because a made-up number beside a real balance is worse than no number. It
        is a market rate for display, and unrelated to <code>priceWei</code> above.
      </p>
      <p>
        Two more routes exist behind a wallet session, <code>GET /api/me</code> and{" "}
        <code>POST /api/nodes/sync</code>, and are covered on{" "}
        <a href="/docs/api/authentication">Authentication</a>. Nothing in this API withdraws, and
        no endpoint here can move funds; see <a href="/docs/withdrawing">Withdrawing</a>.
      </p>

      <h2 id="wei">Wei is a string, always</h2>
      <p>
        Every value field ending in <code>Wei</code> is a decimal string of wei, never a number.
        Values routinely exceed what a double can represent exactly, and a client that parses them
        as numbers loses precision silently rather than failing.
      </p>
      <CodeBlock label="Parsing correctly">{`const res  = await fetch("/api/stats");
const data = await res.json();

const total = BigInt(data.totalDistributedWei);   // correct
const wrong = Number(data.totalDistributedWei);   // loses precision above 2^53`}</CodeBlock>
      <p>
        Timestamps are ISO 8601 strings in UTC, or <code>null</code> when the underlying column is
        empty. Node ids come in two flavours, and every response says which is which; see{" "}
        <a href="/docs/node-numbering">Node numbering</a>.
      </p>

      <h2 id="limits">Rate limits</h2>
      <p>
        Public endpoints are limited per IP in a fixed window of one minute. The limit differs by
        endpoint because the work behind them differs.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Requests per minute per IP</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>/api/stats</code>
            </td>
            <td>120</td>
          </tr>
          <tr>
            <td>
              <code>/api/nodes/:address</code>
            </td>
            <td>60</td>
          </tr>
          <tr>
            <td>
              <code>/api/node/:id</code>
            </td>
            <td>60</td>
          </tr>
          <tr>
            <td>
              <code>/api/distributions</code>
            </td>
            <td>60</td>
          </tr>
          <tr>
            <td>
              <code>/api/deploy-quote</code>
            </td>
            <td>60</td>
          </tr>
          <tr>
            <td>
              <code>/api/price</code>
            </td>
            <td>Not limited. The upstream quote is fetched at most once a minute for everyone.</td>
          </tr>
          <tr>
            <td>
              <code>/api/me</code>
            </td>
            <td>120</td>
          </tr>
          <tr>
            <td>
              <code>/api/nodes/sync</code>, <code>/api/auth/nonce</code>,{" "}
              <code>/api/auth/verify</code>
            </td>
            <td>20</td>
          </tr>
          <tr>
            <td>
              <code>/api/auth/logout</code>
            </td>
            <td>30</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Every answer from a limited endpoint carries the state of your window in headers, whether
        it succeeded or not:
      </p>
      <CodeBlock label="Response headers">{`x-ratelimit-limit:     60
x-ratelimit-remaining: 57
x-ratelimit-reset:     1756041600     # unix seconds
retry-after:           23             # only on a 429`}</CodeBlock>
      <Callout>
        Counters are per server instance, so the effective allowance can be higher than the table
        suggests when several instances are running. Do not build anything that depends on the
        limit being exactly this number; treat it as the floor and back off on a 429.
      </Callout>

      <h2 id="caching">Caching</h2>
      <p>
        Public reads are cacheable for a few seconds at the edge, which is why a figure can lag the
        chain slightly. Nothing derived from a session is ever cached by a shared cache.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Cache-Control</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>/api/stats</code>
            </td>
            <td>
              <code>public, max-age=0, s-maxage=10, stale-while-revalidate=30</code>, plus a short
              in-process memo
            </td>
          </tr>
          <tr>
            <td>
              <code>/api/nodes/:address</code>, <code>/api/node/:id</code>
            </td>
            <td>
              <code>public, max-age=0, s-maxage=5, stale-while-revalidate=15</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>/api/distributions</code>
            </td>
            <td>
              <code>public, max-age=0, s-maxage=10, stale-while-revalidate=30</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>/api/deploy-quote</code>
            </td>
            <td>
              <code>public, max-age=0, s-maxage=30, stale-while-revalidate=90</code>. Short,
              because it is the number a user is about to send money against.
            </td>
          </tr>
          <tr>
            <td>
              <code>/api/price</code>
            </td>
            <td>
              <code>public, max-age=60</code>, browser included, since a spot quote is the same for
              everyone
            </td>
          </tr>
          <tr>
            <td>
              <code>/api/cron/*</code>
            </td>
            <td>
              <code>no-store</code>. A liveness reading is not a document.
            </td>
          </tr>
          <tr>
            <td>Anything behind a session</td>
            <td>
              <code>private, no-store</code>
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="operational">Operational endpoints</h2>
      <p>
        Three routes under <code>/api/cron</code> exist for the scheduler that keeps the protocol
        moving. Two of them do work and are gated by a secret; the third only reports and is open
        to anyone.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Gate</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>/api/cron/payments</code>
            </td>
            <td>
              <code>x-cron-key</code>
            </td>
            <td>
              One pass of the payment pipeline: read new blocks for transfers to the payments
              wallet, then mint a node for each payment that checks out. Every step is idempotent,
              so calling it twice costs RPC and nothing else.
            </td>
          </tr>
          <tr>
            <td>
              <code>/api/cron/credit</code>
            </td>
            <td>
              <code>x-cron-key</code>
            </td>
            <td>
              One credit pass over the nodes that are due. Held by an advisory lock, because two
              passes crediting the same nodes would pay twice.
            </td>
          </tr>
          <tr>
            <td>
              <code>/api/cron/health</code>
            </td>
            <td>None</td>
            <td>
              Whether the credit worker is alive and whether it can still pay. Read only, and
              public on purpose.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Both working routes answer to <code>GET</code> as well as <code>POST</code>, because
        several hosted schedulers only issue <code>GET</code>. There is no body either way. An
        overlapping run is not an error: the second caller gets a 200 with{" "}
        <code>ran: false</code>, because a job that runs every minute and occasionally takes longer
        than a minute is behaving normally.
      </p>
      <h3 id="health">/api/cron/health</h3>
      <p>
        Public because everything in it is already public. The contract&rsquo;s balance, what it
        owes, whether it is solvent and whether payouts are switched on can all be read from the
        chain by anyone, and a node holder has a fair claim to see them without an
        operator&rsquo;s key. What it deliberately leaves out is the identity of any key-holding
        account. The distributor&rsquo;s balance appears as a number with no address attached,
        which says the float is running low without saying where the float lives.
      </p>
      <CodeBlock label="200 application/json">{`{
  "lastTickAt": "…",  "secondsSinceLastTick": 0,
  "stale": false,     "staleAfterSec": 300,  "tickSec": 60,
  "distEnabled": true, "distMode": "treasury",
  "paused": false,
  "dueNodes": 0,      "scheduledNodes": 0,
  "distributorBalanceWei": "…",
  "contractBalanceWei": "…",
  "outstandingWei": "…",
  "isSolvent": true
}`}</CodeBlock>
      <p>
        Any reading that could not be taken is <code>null</code>, never a zero that would look
        measured. A worker that has never ticked reports <code>stale: true</code> with{" "}
        <code>secondsSinceLastTick: null</code>: absent and stale are both wrong, but they are
        different problems. <code>isSolvent</code> is the contract&rsquo;s own answer to whether
        its balance covers everything it owes, and it can be checked directly with{" "}
        <code>isSolvent()</code>; see <a href="/docs/factory-interface">Factory interface</a>.
      </p>

      <h2 id="chain">The chain is the source of truth</h2>
      <p>
        This API serves the operator&rsquo;s ledger. The parts of it that involve money are also on
        chain, and where the two disagree, the chain is right: node ownership through{" "}
        <code>nodesOf(address)</code>, and the owner, balance, credited total and withdrawn total
        for one node through <code>nodeInfo(id)</code>, which returns all five at once. Anything
        that matters for money can be verified without this API at all; see{" "}
        <a href="/docs/factory-interface">Factory interface</a>.
      </p>

      <h2 id="stability">Stability</h2>
      <ul>
        <li>Fields may be added. Ignore ones you do not recognise.</li>
        <li>Existing fields will not change type or meaning without the change appearing in the changelog.</li>
        <li>There is no version prefix in the path, and no plan to add one.</li>
        <li>
          The endpoints under <code>/api/admin</code> are not public and answer 404 when no admin
          key is configured. The same is true of <code>/api/cron/payments</code>. Neither is part
          of this API&rsquo;s surface, and neither is documented field by field.
        </li>
      </ul>
    </DocPage>
  );
}
