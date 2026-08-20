/**
 * GET /api/node/:id?limit=50
 *   -> { id, chainNodeId, owner, balanceWei, credits: [...], withdrawals: [...] }
 *
 * `:id` may be the database row id or the chain node id; both are echoed back,
 * so a caller always knows which node it got. See the ID CONVENTION note in
 * lib/api.ts for why the money routes are stricter than this one.
 */

import {
  checkLimit,
  fail,
  jsonOk,
  mergeHeaders,
  parseChainNodeId,
  parseLimit,
  publicCache,
  toIso,
  toResponse,
  toText,
  toWeiString,
} from "@/lib/api";
import {sql} from "@/lib/db";
import {nodeByEitherId, shapeNodeDetail, type NodeDetail} from "@/lib/nodes";

type CreditRow = {
  id: string;
  distribution_id: string;
  amount_wei: string;
  created_at: Date | string;
};

/**
 * Shaped by migration 002. Withdrawals are no longer prepared and signed by us,
 * so there is no cumulative allowance, no deadline and no pending status to
 * report: a row exists only once the `Withdrawn` event has been observed on
 * chain, which makes every row here already final.
 */
type WithdrawalRow = {
  id: string;
  to_address: string;
  amount_wei: string;
  tx_hash: string;
  block_number: string | number;
  observed_at: Date | string;
};

export type Credit = {
  id: number;
  distributionId: number;
  amountWei: string;
  createdAt: string | null;
};

export type Withdrawal = {
  id: number;
  amountWei: string;
  toAddress: string | null;
  txHash: string | null;
  blockNumber: number;
  observedAt: string | null;
};

export type NodeDetailResponse = NodeDetail & {
  credits: Credit[];
  withdrawals: Withdrawal[];
};

export async function GET(
  req: Request,
  {params}: {params: Promise<{id: string}>},
): Promise<Response> {
  const limit = checkLimit(req, "node-detail", {limit: 60});
  if (limit.blocked) return limit.blocked;

  try {
    const {id} = await params;
    const wanted = parseChainNodeId(id, "id");
    const count = parseLimit(new URL(req.url), {fallback: 50, max: 200});

    const node = await nodeByEitherId(wanted);
    if (!node) fail(404, "No node with that id.");

    const [credits, withdrawals] = await Promise.all([
      sql<CreditRow>`
        select id, distribution_id, amount_wei, created_at
        from credits
        where node_id = ${String(node.id)}::bigint
        order by created_at desc, id desc
        limit ${count}::int
      `,
      // Withdrawals key off the CHAIN node id, not the database row id: the
      // rows are indexed from on-chain events, which only ever carry the chain id.
      sql<WithdrawalRow>`
        select id, to_address, amount_wei, tx_hash, block_number, observed_at
        from withdrawals
        where node_chain_id = ${String(node.chain_node_id)}::numeric
        order by block_number desc, id desc
        limit ${count}::int
      `,
    ]);

    const body: NodeDetailResponse = {
      ...shapeNodeDetail(node),
      credits: credits.map((row) => ({
        id: Number(row.id),
        distributionId: Number(row.distribution_id),
        amountWei: toWeiString(row.amount_wei),
        createdAt: toIso(row.created_at),
      })),
      withdrawals: withdrawals.map((row) => ({
        id: Number(row.id),
        amountWei: toWeiString(row.amount_wei),
        toAddress: toText(row.to_address),
        txHash: toText(row.tx_hash),
        blockNumber: Number(row.block_number),
        observedAt: toIso(row.observed_at),
      })),
    };

    return jsonOk(body, mergeHeaders(limit.headers, publicCache(5)));
  } catch (err) {
    return toResponse(err, "node-detail", limit.headers);
  }
}
