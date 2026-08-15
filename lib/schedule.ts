/**
 * Per-node credit timers.
 *
 * Every node carries its own `next_credit_at`, so nodes drift apart on their
 * own instead of all being paid on one shared beat. A tick takes whichever
 * nodes are due, credits each a separately drawn amount, and only then moves
 * their timers.
 *
 * Two rules matter more than the rest:
 *
 * 1. Timers advance ONLY after the credit transaction is confirmed. If the
 *    chain call fails the timers stay in the past and the next tick simply
 *    tries again, so a failed pass costs a delay and never a lost credit.
 *
 * 2. A node is credited at most once per tick, and its next time is measured
 *    from NOW rather than from the time it was due. An hour of downtime is an
 *    hour without payouts, not an hour of backlog paid out in one lump.
 */

import {sql, type SqlQuery} from "@/lib/db";

/** One tick never touches more than this many nodes; the rest wait for the next. */
export const MAX_NODES_PER_TICK = 200;

export type DueNode = {
  node_chain_id: string;
  next_credit_at: string;
};

/**
 * Give a freshly minted node its first timer. Called right after the node is
 * confirmed on chain, so a node starts accruing without waiting for an
 * operator action.
 */
export async function scheduleNewNode(
  nodeChainId: bigint,
  delaySeconds: number,
  q: SqlQuery = sql,
): Promise<void> {
  await q`
    insert into node_schedule (node_chain_id, next_credit_at)
    values (
      ${nodeChainId.toString()},
      now() + make_interval(secs => ${delaySeconds})
    )
    on conflict (node_chain_id) do nothing
  `;
}

/**
 * Nodes whose timer has come up. Ordered oldest-due first so a backlog drains
 * fairly rather than starving whoever waited longest.
 */
export async function dueNodes(limit = MAX_NODES_PER_TICK): Promise<DueNode[]> {
  return sql<DueNode>`
    select node_chain_id, next_credit_at
      from node_schedule
     where next_credit_at <= now()
     order by next_credit_at asc
     limit ${limit}
  `;
}

/**
 * Move each node's timer forward by its own freshly drawn delay, and record the
 * credit. Call this ONLY after the credit transaction is confirmed.
 *
 * The delay is per node, not one value reused across the batch, which is what
 * keeps nodes from re-synchronising into a single group after the first tick.
 */
export async function advanceSchedules(
  entries: readonly {nodeChainId: bigint; delaySeconds: number}[],
  q: SqlQuery = sql,
): Promise<void> {
  if (entries.length === 0) return;

  const ids = entries.map((e) => e.nodeChainId.toString());
  const delays = entries.map((e) => e.delaySeconds);

  await q`
    update node_schedule s
       set next_credit_at = now() + make_interval(secs => v.delay),
           last_credit_at = now(),
           credits_count = s.credits_count + 1,
           updated_at = now()
      from (
        select unnest(${ids}::numeric[]) as node_chain_id,
               unnest(${delays}::int[])  as delay
      ) as v
     where s.node_chain_id = v.node_chain_id
  `;
}

/**
 * Push timers out without recording a credit. Used when a pass is skipped for
 * a reason that is not the node's fault (paused contract, low distributor
 * balance) and we do not want every skipped node to pile up as instantly-due.
 */
export async function deferAll(seconds: number, q: SqlQuery = sql): Promise<void> {
  await q`
    update node_schedule
       set next_credit_at = now() + make_interval(secs => ${seconds}),
           updated_at = now()
     where next_credit_at <= now()
  `;
}

/** How many nodes are waiting right now, for the admin view. */
export async function dueCount(): Promise<number> {
  const rows = await sql<{n: string}>`
    select count(*)::text as n from node_schedule where next_credit_at <= now()
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function scheduledCount(): Promise<number> {
  const rows = await sql<{n: string}>`select count(*)::text as n from node_schedule`;
  return Number(rows[0]?.n ?? 0);
}
