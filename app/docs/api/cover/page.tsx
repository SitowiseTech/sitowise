import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "GET /api/cover",
  description:
    "Whether node balances are backed by ETH in the contract. Read from the chain rather than the ledger. Fields, types, caching and caveats.",
};

export default function ApiCoverPage() {
  return (
    <DocPage
      href="/docs/api/cover"
      title="GET /api/cover"
      lede={
        <>
          What the contract owes every holder, and what it actually holds. No
          parameters, no authentication.
        </>
      }
    >
      <h2 id="request">Request</h2>
      <CodeBlock label="Request">{`GET /api/cover`}</CodeBlock>
      <p>Takes no parameters. Anything in the query string is ignored.</p>

      <h2 id="response">Response</h2>
      <CodeBlock label="200 application/json">{`{
  "contract": "0x389699d7C3A754d6b82EbBBa0ebE5757ccfA1dD7",
  "balanceWei": "70367814399680116",
  "outstandingWei": "70367814399680116",
  "covered": true,
  "paused": false
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
              <code>contract</code>
            </td>
            <td>string</td>
            <td>The factory the other figures were read from.</td>
          </tr>
          <tr>
            <td>
              <code>balanceWei</code>
            </td>
            <td>string</td>
            <td>ETH the contract holds, read from the node rather than from storage.</td>
          </tr>
          <tr>
            <td>
              <code>outstandingWei</code>
            </td>
            <td>string</td>
            <td>
              Sum of every live node balance. What the contract owes all holders together.
            </td>
          </tr>
          <tr>
            <td>
              <code>covered</code>
            </td>
            <td>boolean</td>
            <td>
              The contract&apos;s own <code>isSolvent</code>. True when the balance is at least
              the outstanding.
            </td>
          </tr>
          <tr>
            <td>
              <code>paused</code>
            </td>
            <td>boolean</td>
            <td>
              Whether minting is paused. Pausing has never been able to block a withdrawal.
            </td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="source">Where the numbers come from</h2>
      <p>
        Unlike <Link href="/docs/api/stats">/api/stats</Link>, this endpoint reads the chain
        rather than our database, and it does so deliberately. The whole value of the figure is
        that it does not depend on our records being honest. Both numbers come out of the same
        block, because a balance compared against an outstanding read one block later is a
        rumour rather than a check.
      </p>
      <p>
        You do not have to take the answer from us at all. Call{" "}
        <Link href="/docs/factory-interface">
          <code>outstanding</code>
        </Link>{" "}
        and read the contract balance yourself on Blockscout, and you are reading the same two
        storage slots this route does.
      </p>

      <Callout tone="warn" title="A 503 is not a zero">
        When the chain cannot be read the route answers <code>503</code> and returns no figures,
        and it never serves a cached <code>covered</code> through an outage. An answer about
        whether somebody&apos;s money is there must not outlive the ability to check.
      </Callout>

      <h2 id="caching">Caching</h2>
      <p>
        Cached for 15 seconds. The numbers move on the scale of a credit round, not of a
        request, and every dashboard visit asks.
      </p>
    </DocPage>
  );
}
