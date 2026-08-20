/**
 * GET /api/nodes/:address
 *   -> [{ id, chainNodeId, createdAt, balanceWei, cumulativeWei, withdrawnWei, mintTx }]
 *
 * Public, because node ownership is public: the same list can be read straight
 * off the contract with nodesOf(address). What this adds is the accrual the
 * ledger holds against each node.
 */

import {checkLimit, fail, jsonOk, mergeHeaders, publicCache, toResponse} from "@/lib/api";
import {isAddress} from "@/lib/format";
import {nodesForOwner, shapeNode, type NodeSummary} from "@/lib/nodes";

export async function GET(
  req: Request,
  {params}: {params: Promise<{address: string}>},
): Promise<Response> {
  const limit = checkLimit(req, "nodes-by-address", {limit: 60});
  if (limit.blocked) return limit.blocked;

  try {
    const {address} = await params;
    if (!isAddress(address)) fail(400, "That is not a valid wallet address.");

    const rows = await nodesForOwner(address);
    const body: NodeSummary[] = rows.map(shapeNode);

    return jsonOk(body, mergeHeaders(limit.headers, publicCache(5)));
  } catch (err) {
    return toResponse(err, "nodes-by-address", limit.headers);
  }
}
