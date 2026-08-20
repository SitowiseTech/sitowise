/**
 * POST /api/nodes/sync  { txHash } | { nodeId }  ->  { registered, nodes: [...] }
 *
 * Registers a node the caller has just minted (spec section 11).
 *
 * The client hands over a transaction hash or a node id and nothing else. The
 * owner and the price paid are read out of the chain's own NodeMinted log, and
 * the owner is then confirmed a second time against ownerOf(). Nothing a client
 * says about who owns a node or what it cost is used, because both are worth
 * money and neither is verifiable from the request.
 *
 * Missing this call is survivable: lib/reconcile.ts finds the same nodes later.
 * This route exists so the dashboard fills in within a second of the mint
 * rather than at the next reconcile.
 */

import {
  checkLimit,
  fail,
  jsonOk,
  mergeHeaders,
  parseChainNodeId,
  parseTxHash,
  PRIVATE_CACHE,
  readJsonBody,
  toResponse,
} from "@/lib/api";
import {recordMintedNodes, type RecordedNode} from "@/lib/reconcile";
import {mintLogsForIds, mintsInReceipt, ownerOfNode, receiptFor, type MintedLog} from "@/lib/rpc";
import {requireSession} from "@/lib/session";

/** A wallet that has just broadcast may call before its node has indexed the receipt. */
const RECEIPT_WAIT_MS = 20_000;

export const maxDuration = 30;

export type SyncResponse = {
  registered: number;
  nodes: RecordedNode[];
};

/** Mints in a confirmed transaction that this session actually owns. */
async function mintsFromTx(txHash: `0x${string}`, session: `0x${string}`): Promise<MintedLog[]> {
  const receipt = await receiptFor(txHash, RECEIPT_WAIT_MS);
  if (!receipt) {
    fail(404, "That transaction has not confirmed yet. Wait for it to land and try again.");
  }
  if (receipt.status !== "success") {
    fail(400, "That transaction failed on chain, so no node was created.");
  }

  const mints = mintsInReceipt(receipt);
  if (mints.length === 0) fail(400, "That transaction did not mint an Sitowise node.");

  const owned = mints.filter((mint) => mint.owner === session);
  if (owned.length === 0) {
    fail(403, "That node belongs to a different wallet. Sign in with the wallet that minted it.");
  }
  return owned;
}

/** The mint log for one node id, once the chain agrees this session owns it. */
async function mintFromNodeId(chainNodeId: bigint, session: `0x${string}`): Promise<MintedLog[]> {
  const owner = await ownerOfNode(chainNodeId);
  if (!owner) fail(404, "No node with that id has been minted.");
  if (owner !== session) {
    fail(403, "That node belongs to a different wallet. Sign in with the wallet that minted it.");
  }

  const scan = await mintLogsForIds([chainNodeId]);
  const mint = scan.logs.find((log) => log.chainNodeId === chainNodeId);
  if (!mint) {
    // The node exists but its mint log is not readable right now, and the
    // transaction hash is a required, unique column. Inventing one would break
    // the ledger's link back to the chain, so report it and let the caller retry.
    fail(404, "Could not find the mint transaction for that node yet. Try again shortly.");
  }
  return [mint];
}

export async function POST(req: Request): Promise<Response> {
  const limit = checkLimit(req, "nodes-sync", {limit: 20});
  if (limit.blocked) return limit.blocked;

  try {
    const session = await requireSession();
    const body = await readJsonBody(req);

    const given = (value: unknown) => value !== undefined && value !== null && value !== "";
    // There is no ledger row yet at this point, so `nodeId` and `chainNodeId`
    // can only mean the same number. Accept either spelling.
    const nodeIdInput = given(body.nodeId) ? body.nodeId : body.chainNodeId;
    if (!given(body.txHash) && !given(nodeIdInput)) {
      fail(400, "Send either the mint transaction hash or the node id.");
    }

    const mints = given(body.txHash)
      ? await mintsFromTx(parseTxHash(body.txHash), session)
      : await mintFromNodeId(parseChainNodeId(nodeIdInput), session);

    // Second opinion on ownership, from current state rather than from a log
    // that a reorg could have stranded.
    const confirmed: MintedLog[] = [];
    for (const mint of mints) {
      const owner = await ownerOfNode(mint.chainNodeId);
      if (owner === session) confirmed.push(mint);
    }
    if (confirmed.length === 0) {
      fail(409, "The chain does not show that node as yours. Wait for the transaction to settle and try again.");
    }

    const nodes = await recordMintedNodes(confirmed);
    const payload: SyncResponse = {
      registered: nodes.filter((node) => node.inserted).length,
      nodes,
    };

    return jsonOk(payload, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "nodes-sync", limit.headers);
  }
}
