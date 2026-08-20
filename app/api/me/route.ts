/**
 * GET /api/me
 *   -> { address, nodes: [...], totals: {...}, unsyncedChainNodeIds: [...] | null }
 *
 * The dashboard's first call. The address comes from the session cookie, so
 * there is nothing to pass and nothing to spoof; 401 means "not signed in" and
 * is a normal answer, not a failure.
 *
 * `unsyncedChainNodeIds` is the gap between what the contract says this wallet
 * owns and what the ledger holds. It is the honest way to surface a mint whose
 * sync call never arrived: the dashboard can offer to register it instead of
 * pretending the node does not exist. It is `null`, never an empty list, when
 * the chain could not be read, because "none missing" and "could not check"
 * are different answers.
 */

import {checkLimit, jsonOk, mergeHeaders, PRIVATE_CACHE, toResponse} from "@/lib/api";
import {nodesForOwner, shapeNode, type NodeSummary} from "@/lib/nodes";
import {chainNodesOf} from "@/lib/rpc";
import {requireSession} from "@/lib/session";

export type MeResponse = {
  address: string;
  nodes: NodeSummary[];
  totals: {
    nodes: number;
    balanceWei: string;
    cumulativeWei: string;
    withdrawnWei: string;
  };
  unsyncedChainNodeIds: string[] | null;
};

/** Node ids the contract attributes to this wallet that the ledger has not recorded. */
async function findUnsynced(address: `0x${string}`, known: NodeSummary[]): Promise<string[] | null> {
  try {
    const onChain = await chainNodesOf(address);
    const recorded = new Set(known.map((node) => node.chainNodeId));
    return onChain.map(String).filter((id) => !recorded.has(id));
  } catch (err) {
    console.error("[api:me] could not read node ownership from the chain:", err);
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "me", {limit: 120});
  if (limit.blocked) return limit.blocked;

  try {
    const address = await requireSession();
    const nodes = (await nodesForOwner(address)).map(shapeNode);

    let balance = 0n;
    let cumulative = 0n;
    let withdrawn = 0n;
    for (const node of nodes) {
      balance += BigInt(node.balanceWei);
      cumulative += BigInt(node.cumulativeWei);
      withdrawn += BigInt(node.withdrawnWei);
    }

    const body: MeResponse = {
      address,
      nodes,
      totals: {
        nodes: nodes.length,
        balanceWei: balance.toString(),
        cumulativeWei: cumulative.toString(),
        withdrawnWei: withdrawn.toString(),
      },
      unsyncedChainNodeIds: await findUnsynced(address, nodes),
    };

    return jsonOk(body, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "me", limit.headers);
  }
}
