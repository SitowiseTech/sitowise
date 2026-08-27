/**
 * Read queries behind the public accrual feed at /ledger.
 *
 * Every number here comes from the database the worker writes, so the page can
 * only ever show rounds that actually committed. Nothing is estimated,
 * projected or filled in: when a query returns nothing the caller renders "No
 * data yet" rather than a zero that looks like a measurement.
 *
 * Wei columns are numeric(78,0) and arrive as strings, so they are converted
 * with BigInt, never Number.
 */

import {dbConfigured, sql} from "@/lib/db";

export type LedgerSummary = {
  totalDistributedWei: bigint;
  distributed24hWei: bigint;
  rounds24h: number;
  totalRounds: number;
  activeNodes: number;
  operators: number;
  lastDistributionAt: Date | null;
  firstDistributionAt: Date | null;
};

export type DistributionRow = {
  id: number;
  mode: string;
  totalWei: bigint;
  nodeCount: number;
  createdAt: Date;
};

export type CreditRow = {
  id: number;
  distributionId: number;
  nodeId: number;
  chainNodeId: string;
  ownerAddress: string;
  amountWei: bigint;
  createdAt: Date;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

const EMPTY_SUMMARY: LedgerSummary = {
  totalDistributedWei: 0n,
  distributed24hWei: 0n,
  rounds24h: 0,
  totalRounds: 0,
  activeNodes: 0,
  operators: 0,
  lastDistributionAt: null,
  firstDistributionAt: null,
};

/**
 * True once the ledger has something real to show. The page uses it to choose
 * between the feed and the empty state, so it is not the same as "the database
 * is reachable".
 */
export function hasActivity(summary: LedgerSummary): boolean {
  return summary.totalRounds > 0;
}

export async function ledgerSummary(): Promise<LedgerSummary> {
  if (!dbConfigured()) return EMPTY_SUMMARY;

  const [row] = await sql<{
    total: string;
    total_24h: string;
    rounds_24h: string;
    total_rounds: string;
    active_nodes: string;
    operators: string;
    last_at: Date | string | null;
    first_at: Date | string | null;
  }>`
    select
      (select coalesce(sum(total_wei), 0) from distributions)                    as total,
      (select coalesce(sum(total_wei), 0) from distributions
        where created_at > now() - interval '24 hours')                          as total_24h,
      (select count(*) from distributions
        where created_at > now() - interval '24 hours')                          as rounds_24h,
      (select count(*) from distributions)                                       as total_rounds,
      (select count(*) from nodes where status = 'active')                       as active_nodes,
      (select count(distinct owner_address) from nodes where status = 'active')  as operators,
      (select max(created_at) from distributions)                                as last_at,
      (select min(created_at) from distributions)                                as first_at
  `;

  if (!row) return EMPTY_SUMMARY;
  return {
    totalDistributedWei: BigInt(row.total),
    distributed24hWei: BigInt(row.total_24h),
    rounds24h: Number(row.rounds_24h),
    totalRounds: Number(row.total_rounds),
    activeNodes: Number(row.active_nodes),
    operators: Number(row.operators),
    lastDistributionAt: row.last_at === null ? null : toDate(row.last_at),
    firstDistributionAt: row.first_at === null ? null : toDate(row.first_at),
  };
}

export async function recentDistributions(limit = 50): Promise<DistributionRow[]> {
  if (!dbConfigured()) return [];
  const rows = await sql<{
    id: string;
    mode: string;
    total_wei: string;
    node_count: number;
    created_at: Date | string;
  }>`
    select id, mode, total_wei, node_count, created_at
    from distributions order by created_at desc limit ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    mode: r.mode,
    totalWei: BigInt(r.total_wei),
    nodeCount: Number(r.node_count),
    createdAt: toDate(r.created_at),
  }));
}

/** Individual credits, newest first, for the per-node side of the feed. */
export async function recentCredits(limit = 50): Promise<CreditRow[]> {
  if (!dbConfigured()) return [];
  const rows = await sql<{
    id: string;
    distribution_id: string;
    node_id: string;
    chain_node_id: string;
    owner_address: string;
    amount_wei: string;
    created_at: Date | string;
  }>`
    select c.id, c.distribution_id, c.node_id, n.chain_node_id, n.owner_address,
           c.amount_wei, c.created_at
    from credits c
    join nodes n on n.id = c.node_id
    order by c.created_at desc, c.id desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    distributionId: Number(r.distribution_id),
    nodeId: Number(r.node_id),
    chainNodeId: r.chain_node_id,
    ownerAddress: r.owner_address,
    amountWei: BigInt(r.amount_wei),
    createdAt: toDate(r.created_at),
  }));
}
