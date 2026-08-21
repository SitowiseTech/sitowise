import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "API errors",
  description:
    "The single error envelope, every status code the Sitowise API returns, which ones are worth retrying, and how contract reverts surface.",
};

export default function ApiErrorsPage() {
  return (
    <DocPage
      href="/docs/api/errors"
      title="Errors"
      lede={
        <>
          One error shape everywhere, a correct status code, and a message written for a person.
          Nothing internal is ever sent to a client.
        </>
      }
    >
      <h2 id="envelope">The envelope</h2>
      <CodeBlock label="Every error, without exception">{`{ "error": "That is not a valid wallet address." }`}</CodeBlock>
      <p>
        One field. No error codes, no nested detail object, no stack trace, no SQL, and no
        environment variable names. When something unexpected happens, the detail goes to the
        server log and the client gets a sentence it can show a user.
      </p>
      <Callout>
        Match on the status code, not on the message text. Messages are written for people and can
        be reworded; statuses are the contract.
      </Callout>

      <h2 id="statuses">Status codes</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning</th>
            <th>Retry</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>200</td>
            <td>Success. An empty array is a success, not an error.</td>
            <td>Not applicable</td>
          </tr>
          <tr>
            <td>400</td>
            <td>
              The request was malformed: a bad address, a non-numeric id, a limit out of range, a
              value larger than a uint256, a body that is not a JSON object, or a transaction that
              exists but does not say what the caller claims.
            </td>
            <td>No, fix the request</td>
          </tr>
          <tr>
            <td>401</td>
            <td>
              Not signed in, the session expired, or a sign-in signature that did not verify. On{" "}
              <code>/api/me</code> this is a normal answer for a visitor who has not connected.
              Also what an admin route returns for a wrong <code>x-admin-key</code>.
            </td>
            <td>After signing in again</td>
          </tr>
          <tr>
            <td>403</td>
            <td>
              The thing exists but is not yours. Only <code>/api/nodes/sync</code> returns this,
              when the chain names a different wallet as the node&rsquo;s owner.
            </td>
            <td>No, sign in with the owning wallet</td>
          </tr>
          <tr>
            <td>404</td>
            <td>
              No such node, or a mint transaction that has not confirmed yet. Also what admin
              routes return when no admin key is configured, so an unconfigured admin surface does
              not advertise itself.
            </td>
            <td>Only for the unconfirmed-transaction case</td>
          </tr>
          <tr>
            <td>409</td>
            <td>
              The request was well formed but the chain does not agree with it. Only{" "}
              <code>/api/nodes/sync</code> returns this.
            </td>
            <td>Yes, once the transaction has settled</td>
          </tr>
          <tr>
            <td>429</td>
            <td>
              Rate limited. The response carries <code>retry-after</code> in seconds.
            </td>
            <td>
              Yes, after <code>retry-after</code>
            </td>
          </tr>
          <tr>
            <td>500</td>
            <td>An unexpected failure. Details are in the server log, never in the response.</td>
            <td>Yes, with backoff</td>
          </tr>
          <tr>
            <td>503</td>
            <td>
              The service is misconfigured or a dependency is unavailable, for example no reachable
              database, or no payments address configured for{" "}
              <code>/api/deploy-quote</code> to quote.
            </td>
            <td>Yes, with backoff</td>
          </tr>
        </tbody>
      </DocTable>

      <h2 id="handling">Handling them</h2>
      <CodeBlock label="A correct client">{`async function getJson<T>(url: string): Promise<T> {
  const res  = await fetch(url, {headers: {accept: "application/json"}});
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    // The envelope is guaranteed on every error status.
    const message = body && typeof body === "object" && "error" in body
      ? String(body.error)
      : \`Request failed with status \${res.status}\`;

    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 5);
      throw new RetryableError(message, wait);
    }
    throw new Error(message);
  }

  return body as T;
}`}</CodeBlock>
      <p>
        Retry 429, 500 and 503 with exponential backoff. Do not retry 400, 401 or 403, because
        nothing about the request will have changed. The two that depend on timing are 404 and 409
        on <code>/api/nodes/sync</code>: both can mean the chain has not caught up yet, and both
        clear on their own once the transaction settles.
      </p>

      <h2 id="ratelimit">Rate limit responses</h2>
      <CodeBlock label="429">{`HTTP/1.1 429 Too Many Requests
x-ratelimit-limit:     60
x-ratelimit-remaining: 0
x-ratelimit-reset:     1756041660
retry-after:           23

{ "error": "Too many requests. Slow down and try again shortly." }`}</CodeBlock>
      <p>
        The three <code>x-ratelimit-</code> headers are on every answer, success or failure, so a
        client can slow down before it is refused. <code>retry-after</code> appears only on a 429.{" "}
        <code>x-ratelimit-reset</code> is unix seconds, not a duration.
      </p>
      <p>
        Windows are one minute and fixed, not sliding, so the allowance refills all at once at{" "}
        <code>x-ratelimit-reset</code>. The limit differs by endpoint, from 120 a minute on{" "}
        <code>/api/stats</code> and <code>/api/me</code> down to 20 on the sign-in routes and{" "}
        <code>/api/nodes/sync</code>; the full table is on{" "}
        <Link href="/docs/api">the API overview</Link>. Counters are held per server instance,
        which means the practical allowance can exceed the documented one. Treat the documented
        figure as the floor.
      </p>

      <h2 id="reverts">Withdrawal failures are contract reverts, not API errors</h2>
      <p>
        Withdrawing does not touch this API. It is a call your own wallet makes to the factory, so
        when it fails, the failure comes back from the chain as a revert and nothing on this page
        applies to it. There is no status code, no <code>error</code> field, and no endpoint to
        ask.
      </p>
      <p>
        The custom errors the contract can revert with, all of which take no arguments, are listed
        on <Link href="/docs/factory-interface">Factory interface</Link>. What each one means in
        practice, and what to do about it, is on{" "}
        <Link href="/docs/withdrawing">Withdrawing</Link>, with the wider set of symptoms on{" "}
        <Link href="/docs/troubleshooting">Troubleshooting</Link>. A revert costs gas and changes
        nothing else: a failed withdrawal leaves the node&rsquo;s balance exactly where it was.
      </p>

      <h2 id="preflight">When the API refuses before the chain would</h2>
      <p>
        One route deliberately answers with an error rather than writing something the chain does
        not agree with. <code>POST /api/nodes/sync</code> takes a mint transaction hash or a node
        id and nothing else. It reads the owner out of the chain&rsquo;s own{" "}
        <code>NodeMinted</code> log, then confirms that owner a second time against{" "}
        <code>nodeInfo</code>, and nothing the client says about ownership is used at any point.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Status</th>
            <th>What it caught</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>400</td>
            <td>
              Neither a transaction hash nor a node id was sent, the transaction failed on chain,
              or it confirmed without minting a node
            </td>
          </tr>
          <tr>
            <td>403</td>
            <td>The node is real, and the chain says it belongs to another wallet</td>
          </tr>
          <tr>
            <td>404</td>
            <td>
              No node with that id has been minted, or the transaction has not confirmed and its
              mint log cannot be read yet
            </td>
          </tr>
          <tr>
            <td>409</td>
            <td>
              The log named this wallet, but current state no longer does. Nothing is recorded
              rather than recording a node a reorg has stranded.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        Missing this call entirely is survivable. The reconciler finds the same nodes from the
        chain later, so the route only decides how quickly the dashboard fills in, never whether
        the node exists.
      </p>
      <p>
        <code>GET /api/deploy-quote</code> refuses in the same spirit. It quotes the payments
        address and the exact wei a transfer must carry, both of which come from the
        server&rsquo;s configuration rather than from the contract. With no payments address
        configured it answers 503 rather than quoting a zero address, because a transfer sent
        against a quote of zeroes would be gone and would still not be a node.
      </p>

      <h2 id="empty">Empty is not an error</h2>
      <ul>
        <li>
          A wallet with no nodes returns <code>[]</code> with status 200.
        </li>
        <li>
          A protocol with no distributions returns <code>[]</code> with status 200.
        </li>
        <li>
          <code>/api/stats</code> on a fresh deployment returns zeroes, not an error.
        </li>
        <li>
          Nullable fields are <code>null</code> when unknown, never a placeholder value. In
          particular, &quot;could not check&quot; and &quot;nothing found&quot; are different
          answers and are represented differently.
        </li>
      </ul>
      <p>
        Interfaces built on this API should say &quot;no data yet&quot; in those cases, which is
        what the charts throughout these docs do.
      </p>
    </DocPage>
  );
}
