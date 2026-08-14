/**
 * Neon Postgres access.
 *
 * Two paths, deliberately:
 *   `sql`  — one statement over HTTP. No connection to hold, right for API
 *            routes and page reads.
 *   `tx`   — a real interactive transaction over a pooled WebSocket
 *            connection. The distribution write reads an id, then inserts
 *            credits, then updates balances; that cannot be expressed as
 *            Neon's non-interactive HTTP transaction, and a half-applied
 *            distribution would corrupt the ledger.
 *
 * Every wei column is `numeric(78,0)`; the driver returns those as strings.
 * Callers convert with BigInt() rather than Number(), which would silently
 * lose precision above 2^53.
 */

import {neon, neonConfig, Pool, type NeonQueryFunction} from "@neondatabase/serverless";
import {databaseUrl} from "@/lib/env";

export type Row = Record<string, unknown>;

/** Tagged template that returns rows. Both `sql` and the `tx` handle match it. */
export type SqlQuery = <T = Row>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>;

/** Captured outside the null check below, where the property narrows to `undefined`. */
type WebSocketCtor = NonNullable<typeof neonConfig.webSocketConstructor>;

/* --------------------------------------------------------------- http client */

// Cached across invocations: `neon()` builds a fetch wrapper, not a socket, so
// keeping it costs nothing and re-parsing the URL on every query is waste.
let httpClient: NeonQueryFunction<false, false> | null = null;

function http(): NeonQueryFunction<false, false> {
  if (!httpClient) httpClient = neon(databaseUrl());
  return httpClient;
}

/**
 * Single statement. Values interpolate as bound parameters, never as text:
 * ``sql`select * from nodes where id = ${id}` `` is parameterised.
 */
export function sql<T = Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
  return http()(strings, ...values) as unknown as Promise<T[]>;
}

/** True when DATABASE_URL is present, so callers can render "No data yet" locally. */
export function dbConfigured(): boolean {
  try {
    databaseUrl();
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------- pool */

// Survives dev hot reloads; without this every edit would leak a socket pool.
const globalForPool = globalThis as unknown as {__sitowisePool?: Pool};

function pool(): Pool {
  if (globalForPool.__sitowisePool) return globalForPool.__sitowisePool;

  if (!neonConfig.webSocketConstructor) {
    const ctor = (globalThis as {WebSocket?: unknown}).WebSocket;
    if (!ctor) {
      throw new Error(
        "No WebSocket implementation available for Neon transactions. Run on Node 22 or newer, " +
          "or set neonConfig.webSocketConstructor before calling tx().",
      );
    }
    neonConfig.webSocketConstructor = ctor as WebSocketCtor;
  }

  const created = new Pool({
    connectionString: databaseUrl(),
    // Transactions are short and rare next to the HTTP path; a small pool with
    // an idle timeout keeps serverless instances from pinning sockets open.
    max: 4,
    idleTimeoutMillis: 30_000,
  });
  // An unhandled 'error' on an idle client would take the whole process down,
  // and the distribution worker must survive a dropped connection.
  created.on("error", (err: Error) => {
    console.error("[db] idle client error:", err.message);
  });

  globalForPool.__sitowisePool = created;
  return created;
}

/** Build `$1, $2 …` from a tagged template. */
function toParameterised(strings: TemplateStringsArray, values: unknown[]): {text: string; params: unknown[]} {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1]}`;
  }
  return {text, params: values};
}

/**
 * Run `fn` inside one Postgres transaction. Commits on return, rolls back on
 * throw. The handle passed in is the same tagged-template shape as `sql`, so
 * query code reads identically inside and outside a transaction.
 */
export async function tx<T>(fn: (q: SqlQuery) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");

    const q: SqlQuery = <R = Row>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const {text, params} = toParameterised(strings, values);
      return client.query(text, params).then((res) => res.rows as R[]);
    };

    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (err) {
    // A failed rollback (socket already gone) must not mask the real error.
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` while holding a Postgres advisory lock, so two concurrent callers
 * cannot both do the work. Returns `{ran: false}` without calling `fn` when the
 * lock is already held — the caller should treat that as success and exit
 * quietly, not as an error.
 *
 * Deliberately SESSION scoped (`pg_try_advisory_lock`) rather than transaction
 * scoped: the credit pass sends a transaction and waits for its receipt between
 * database writes, and holding an open Postgres transaction across a network
 * round trip would pin a connection for many seconds. A session lock spans the
 * short writes on either side of the chain call instead.
 *
 * The lock lives on one pooled connection and is released in `finally` on that
 * same connection. If the process dies mid-pass the session dies with it and
 * Postgres drops the lock, so a crash cannot wedge the worker permanently.
 *
 * The HTTP driver cannot be used for this: it ends the session after each
 * statement, which would release the lock immediately and silently.
 */
export async function withAdvisoryLock<T>(
  key: number,
  fn: (q: SqlQuery) => Promise<T>,
): Promise<{ran: true; result: T} | {ran: false}> {
  const client = await pool().connect();
  try {
    const got = await client.query<{locked: boolean}>("select pg_try_advisory_lock($1) as locked", [
      key,
    ]);
    if (!got.rows[0]?.locked) return {ran: false};

    try {
      const q: SqlQuery = <R = Row>(strings: TemplateStringsArray, ...values: unknown[]) => {
        const {text, params} = toParameterised(strings, values);
        return client.query(text, params).then((res) => res.rows as R[]);
      };
      return {ran: true, result: await fn(q)};
    } finally {
      // Must run on the connection that took it; a different one cannot unlock.
      await client.query("select pg_advisory_unlock($1)", [key]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Close pooled sockets. For the worker's shutdown handler; routes never need it. */
export async function closePool(): Promise<void> {
  const existing = globalForPool.__sitowisePool;
  if (!existing) return;
  globalForPool.__sitowisePool = undefined;
  await existing.end();
}
