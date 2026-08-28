/**
 * Reading nodes out of the ledger.
 *
 * Everything goes through the `node_view` view from db/schema.sql, which is the
 * one place `balance_wei = cumulative_wei - withdrawn_wei` is defined. Routes
 * that computed that subtraction themselves would eventually disagree with each
 * other, and a dashboard that disagrees with a withdrawal preflight is worse
 * than one that is a second out of date.
 */

import {toIso, toText, toWeiString} from "@/lib/api";
import {sql} from "@/lib/db";

export type NodeViewRow = {
  id: string | number;
  chain_node_id: string;
  owner_address: string;
  mint_tx_hash: string;
  price_wei: string;
  tier: string | null;
  status: string;
  created_at: Date | string | null;
  cumulative_wei: string;
  withdrawn_wei: string;
  balance_wei: string;
};

/** The list shape from spec section 13. Wei values are decimal strings, never numbers. */
export type NodeSummary = {
  id: number;
  chainNodeId: string;
  createdAt: string | null;
  balanceWei: string;
  cumulativeWei: string;
  withdrawnWei: string;
  mintTx: string;
  status: string | null;
  /** Null on nodes recorded before tiers existed, which read as base. */
  tier: string | null;
};

export function shapeNode(row: NodeViewRow): NodeSummary {
  return {
    id: Number(row.id),
    chainNodeId: String(row.chain_node_id),
    createdAt: toIso(row.created_at),
    balanceWei: toWeiString(row.balance_wei),
    cumulativeWei: toWeiString(row.cumulative_wei),
    withdrawnWei: toWeiString(row.withdrawn_wei),
    mintTx: String(row.mint_tx_hash),
    status: toText(row.status),
    tier: toText(row.tier),
  };
}

/** Everything the detail page shows, the summary plus the fields it adds. */
export type NodeDetail = NodeSummary & {
  owner: string | null;
  priceWei: string;
};

export function shapeNodeDetail(row: NodeViewRow): NodeDetail {
  return {
    ...shapeNode(row),
    owner: toText(row.owner_address),
    priceWei: toWeiString(row.price_wei),
  };
}

/** Every node a wallet owns, oldest first so ids read in the order they were bought. */
export function nodesForOwner(owner: string): Promise<NodeViewRow[]> {
  return sql<NodeViewRow>`
    select * from node_view
    where owner_address = ${owner.toLowerCase()}
    order by chain_node_id asc
  `;
}

/**
 * One node by the id the contract knows it as. Chain ids are the only ids the
 * money paths speak, because they are the ones `withdraw` and `creditBatch`
 * take; a ledger row id accepted there would eventually credit the wrong node.
 */
export async function nodeByChainId(chainNodeId: bigint): Promise<NodeViewRow | null> {
  const rows = await sql<NodeViewRow>`
    select * from node_view where chain_node_id = ${chainNodeId.toString()}::numeric
  `;
  return rows[0] ?? null;
}

/** Largest value a Postgres `bigint` column can hold; `nodes.id` is one. */
const MAX_INT8 = 9223372036854775807n;

/**
 * One node by either id. The database row id and the chain node id are
 * different numbers for the same thing, and a public reader has no way to know
 * which one they are holding. Row id wins when both match, and the response
 * carries both, so the answer is never ambiguous.
 */
export async function nodeByEitherId(value: bigint): Promise<NodeViewRow | null> {
  if (value <= MAX_INT8) {
    const rows = await sql<NodeViewRow>`
      select * from node_view where id = ${value.toString()}::bigint
    `;
    if (rows.length > 0) return rows[0];
  }
  return nodeByChainId(value);
}
