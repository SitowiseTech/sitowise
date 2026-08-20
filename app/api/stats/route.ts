/**
 * GET /api/stats  ->  { totalNodes, totalDistributedWei, distributions24hWei, operators }
 *
 * The counters behind the landing page. All four come from the ledger, so a
 * fresh deployment answers with zeroes rather than with a made-up figure.
 */

import {checkLimit, jsonOk, mergeHeaders, publicCache, toCount, toResponse, toWeiString} from "@/lib/api";
import {sql} from "@/lib/db";

type StatsRow = {
  total_nodes: string;
  operators: string;
  total_distributed_wei: string;
  distributions_24h_wei: string;
};

export type Stats = {
  totalNodes: number;
  totalDistributedWei: string;
  distributions24hWei: string;
  operators: number;
};

const CACHE_SECONDS = 10;

// Every visitor to the landing page hits this. One row of aggregates is cheap,
// but not cheap enough to run per request during a traffic spike, and the
// numbers are not meaningful to the second.
let memo: {at: number; value: Stats} | null = null;

async function readStats(): Promise<Stats> {
  const now = Date.now();
  if (memo && now - memo.at < CACHE_SECONDS * 1000) return memo.value;

  const rows = await sql<StatsRow>`
    select
      (select count(*) from nodes where status = 'active')                      as total_nodes,
      (select count(distinct owner_address) from nodes where status = 'active') as operators,
      (select coalesce(sum(total_wei), 0) from distributions)                   as total_distributed_wei,
      (select coalesce(sum(total_wei), 0) from distributions
         where created_at > now() - interval '24 hours')                        as distributions_24h_wei
  `;

  const row = rows[0];
  const value: Stats = {
    totalNodes: toCount(row?.total_nodes),
    totalDistributedWei: toWeiString(row?.total_distributed_wei),
    distributions24hWei: toWeiString(row?.distributions_24h_wei),
    operators: toCount(row?.operators),
  };

  memo = {at: now, value};
  return value;
}

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "stats", {limit: 120});
  if (limit.blocked) return limit.blocked;

  try {
    return jsonOk(await readStats(), mergeHeaders(limit.headers, publicCache(CACHE_SECONDS)));
  } catch (err) {
    return toResponse(err, "stats", limit.headers);
  }
}
