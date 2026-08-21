import type {Metadata} from "next";
import Link from "next/link";
import {CodeBlock} from "@/components/docs/CodeBlock";
import {DocPage, DocTable} from "@/components/docs/DocPage";
import {Callout} from "@/components/ui/Callout";

export const metadata: Metadata = {
  title: "Authentication",
  description:
    "What the Sitowise API serves without any credentials, and how the wallet session cookie works for the endpoints that need one.",
};

export default function AuthenticationPage() {
  return (
    <DocPage
      href="/docs/api/authentication"
      lede={
        <>
          Everything worth reading is public and needs no credentials. A session exists only for
          the endpoints that act on behalf of one wallet, and it is created by signing a message,
          not by a password.
        </>
      }
    >
      <h2 id="public">Public, no credentials</h2>
      <p>
        Node ownership is public data. The same list can be read off the contract with{" "}
        <code>nodesOf(address)</code>, so putting it behind a key would protect nothing and only
        make the protocol harder to verify.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Needs</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET /api/stats</code>
            </td>
            <td>Nothing</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/nodes/:address</code>
            </td>
            <td>Nothing</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/node/:id</code>
            </td>
            <td>Nothing</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/distributions</code>
            </td>
            <td>Nothing</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/deploy-quote</code>
            </td>
            <td>Nothing</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/price</code>
            </td>
            <td>Nothing</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/cron/health</code>
            </td>
            <td>Nothing</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        <code>/api/deploy-quote</code> is unauthenticated because a wallet needs the payment
        address and the exact amount before it has signed anything, and{" "}
        <code>/api/cron/health</code> because everything it reports is already readable from the
        chain. Both are covered on <Link href="/docs/api">the API overview</Link>.
      </p>

      <h2 id="session">Session endpoints</h2>
      <p>
        A session is needed for the routes that act for a specific wallet. There are two, and they
        exist for the dashboard rather than for general use.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET /api/me</code>
            </td>
            <td>
              The signed-in wallet, its nodes, totals, and any node the chain shows that the ledger
              has not recorded
            </td>
          </tr>
          <tr>
            <td>
              <code>POST /api/nodes/sync</code>
            </td>
            <td>Register a node that was just minted, from its transaction hash or id</td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        There is no session route for withdrawing, because withdrawing does not go through this
        API at all. See <Link href="/docs/withdrawing">Withdrawing</Link>.
      </p>

      <h2 id="signin">Signing in</h2>
      <p>Two calls, and one wallet signature between them.</p>
      <CodeBlock label="Step 1: get a nonce and the exact message to sign">{`POST /api/auth/nonce      // GET works too and returns the same thing
-> { "nonce": "…", "message": "…" }`}</CodeBlock>
      <p>
        The nonce is also set in an httpOnly cookie. The signature is verified against that copy,
        so a nonce captured from the response body is useless in another browser. The{" "}
        <code>message</code> field is the exact string to pass to <code>personal_sign</code>;
        rebuilding it yourself risks drifting from what the server verifies.
      </p>
      <CodeBlock label="Step 2: send the signature">{`POST /api/auth/verify
{ "address": "0x…", "signature": "0x…" }

-> { "address": "0x…" }  plus a session cookie`}</CodeBlock>
      <p>
        The address in the body is not a claim of identity on its own. It is accepted only because
        the signature over this browser&rsquo;s nonce recovers to it, and the nonce cookie is
        deleted as soon as it has been used, so a captured signature cannot be replayed. Every
        route after this one reads the address from the cookie, never from a body.
      </p>
      <p>
        Signing in is not a transaction. It costs no gas, appears nowhere on chain, and grants no
        permission to move funds. It proves one thing: that you control the private key for that
        address.
      </p>
      <CodeBlock label="Signing out">{`POST /api/auth/logout
-> { "ok": true }        // clears the session and any half-finished sign-in`}</CodeBlock>
      <p>
        Signing out always succeeds. Ending a session that had already lapsed is not an error.
      </p>

      <h2 id="cookie">The cookie</h2>
      <ul>
        <li>
          <strong>httpOnly</strong>, so page scripts cannot read it.
        </li>
        <li>
          <strong>Signed</strong> with a server secret. The value is the address, the expiry, and
          an HMAC over the two, so it cannot be forged or edited.
        </li>
        <li>
          <strong>SameSite=Lax</strong>, so another site cannot cause your browser to use it, and{" "}
          <strong>Secure</strong> in production.
        </li>
        <li>
          <strong>Expiring</strong>, seven days from sign-in. When it lapses, sign in again.
        </li>
        <li>
          <strong>Stateless</strong>. Nothing is stored server side, so there is no session table
          holding a list of who is signed in.
        </li>
      </ul>
      <p>
        Requests carrying a session are answered with{" "}
        <code>cache-control: private, no-store</code>, so nothing about one wallet can be served to
        another from a shared cache.
      </p>

      <h2 id="what-session-cannot">What a session cannot do</h2>
      <Callout tone="warn">
        <p>
          A session cannot move your funds, and the reason is stronger than a permission check.
          Withdrawing is a direct call from the node owner&rsquo;s own wallet to the factory. The
          contract compares the caller against <code>node.owner</code> and reverts if they differ,
          so the only thing that can withdraw is the key that owns the node. The server has no
          part in it: it signs nothing, approves nothing, and holds no key that could authorise a
          payout.
        </p>
        <p>
          What a stolen session gets someone is a view of data that is mostly public anyway. Node
          ownership, balances and history can all be read from the contract by anyone. Revoke a
          session you do not trust with <code>POST /api/auth/logout</code>, then treat the wallet
          itself as the thing that actually needs protecting. See{" "}
          <Link href="/docs/withdrawing">Withdrawing</Link> and{" "}
          <Link href="/docs/security-model">Security model</Link>.
        </p>
      </Callout>

      <h2 id="admin">Operator keys</h2>
      <p>
        Two header secrets exist alongside the wallet session. Neither is part of the public API,
        neither is documented field by field, and no wallet signature grants either one: they are
        server configuration, not something a user can hold.
      </p>
      <DocTable>
        <thead>
          <tr>
            <th>Header</th>
            <th>Gates</th>
            <th>When it is not configured</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>x-admin-key</code>
            </td>
            <td>
              Everything under <code>/api/admin</code>
            </td>
            <td>404, so an unconfigured admin surface does not advertise that it exists</td>
          </tr>
          <tr>
            <td>
              <code>x-cron-key</code>
            </td>
            <td>
              <code>/api/cron/payments</code> and <code>/api/cron/credit</code>, the two scheduled
              passes that mint nodes and credit balances
            </td>
            <td>
              <code>/api/cron/payments</code> answers 404, for the same reason as the admin
              surface. <code>/api/cron/credit</code> fails closed with a 401 instead: a route that
              spends real ETH must refuse everyone rather than open up when a variable is missing.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        <code>/api/cron/payments</code> also accepts the key as{" "}
        <code>authorization: Bearer</code>, because some schedulers can only set that header.{" "}
        <code>/api/cron/credit</code> reads <code>x-cron-key</code> only. Both keys are compared in
        constant time, and a wrong key is answered with 401 and no detail.{" "}
        <code>/api/cron/health</code> takes no key at all; it only reports.
      </p>

      <h2 id="statuses">Status codes you will see</h2>
      <DocTable>
        <thead>
          <tr>
            <th>Status</th>
            <th>Meaning on a session route</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>200</td>
            <td>Signed in, request served</td>
          </tr>
          <tr>
            <td>400</td>
            <td>
              The body was malformed: not JSON, not an object, a missing field, or an id or hash
              that does not parse
            </td>
          </tr>
          <tr>
            <td>401</td>
            <td>
              Not signed in, the session expired, the sign-in nonce had already been used or
              lapsed, or the signature did not recover to the address given. On{" "}
              <code>/api/me</code> this is a normal answer for a visitor who has not connected.
            </td>
          </tr>
          <tr>
            <td>403</td>
            <td>
              On <code>/api/nodes/sync</code>: the node exists but belongs to a different wallet
            </td>
          </tr>
          <tr>
            <td>404</td>
            <td>
              On <code>/api/nodes/sync</code>: no such node, or its mint transaction has not
              confirmed yet
            </td>
          </tr>
          <tr>
            <td>409</td>
            <td>
              On <code>/api/nodes/sync</code>: the chain no longer shows that node as yours, so
              nothing was recorded
            </td>
          </tr>
          <tr>
            <td>429</td>
            <td>
              Rate limited. Sign-in and <code>/api/nodes/sync</code> are limited more tightly than
              reads: 20 requests per minute per IP, against 120 for <code>/api/me</code>.
            </td>
          </tr>
        </tbody>
      </DocTable>
      <p>
        The full table, including what each error means and whether retrying helps, is on{" "}
        <Link href="/docs/api/errors">Errors</Link>.
      </p>
    </DocPage>
  );
}
