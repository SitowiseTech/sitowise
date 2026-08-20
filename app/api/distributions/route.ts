/**
 * GET /api/distributions?limit=50  ->  [{ id, mode, totalWei, nodeCount, createdAt }]
 *
 * The public run of distributions, newest first. `mode` says where the money in
 * that run came from: `treasury` means Sitowise funded it, `swaps` means it came
 * from hook revenue. It is on the record for every row rather than described
 * once in prose.
 */

import {
  checkLimit,
  jsonOk,
  mergeHeaders,
  parseLimit,
  publicCache,
  toCount,
  toIso,
  toResponse,
  toText,
  toWeiString,
} from "@/lib/api";
import {sql} from "@/lib/db";

type DistributionRow = {
  id: string;
  mode: string;
  total_wei: string;
  node_count: number | string;
  created_at: Date | string;
};

export type DistributionSummary = {
  id: number;
  mode: string | null;
  totalWei: string;
  nodeCount: number;
  createdAt: string | null;
};

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "distributions", {limit: 60});
  if (limit.blocked) return limit.blocked;

  try {
    const count = parseLimit(new URL(req.url), {fallback: 50, max: 200});

    const rows = await sql<DistributionRow>`
      select id, mode, total_wei, node_count, created_at
      from distributions
      order by created_at desc, id desc
      limit ${count}::int
    `;

    const body: DistributionSummary[] = rows.map((row) => ({
      id: Number(row.id),
      mode: toText(row.mode),
      totalWei: toWeiString(row.total_wei),
      nodeCount: toCount(row.node_count),
      createdAt: toIso(row.created_at),
    }));

    return jsonOk(body, mergeHeaders(limit.headers, publicCache(10)));
  } catch (err) {
    return toResponse(err, "distributions", limit.headers);
  }
}
