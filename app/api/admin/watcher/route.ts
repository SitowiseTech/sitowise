/**
 * GET  /api/admin/watcher  ->  WatcherHealth
 * POST /api/admin/watcher  { action: "fast-forward", confirm, toBlock }  ->  FastForwardResult
 *
 * Where payment discovery stands, and the one manual lever it has.
 *
 * GET is a read: cursor, chain head, how far behind, whether the address index
 * is answering. It is the same reading /admin renders, in a form a script can
 * poll.
 *
 * POST moves the cursor forward over a range, and is deliberately awkward to
 * reach by accident. It needs `x-admin-key` in a header — no cookie session, so
 * no navigation and no cross-site form can ever trigger it — plus the literal
 * action, the exact confirmation phrase, and a target block number the operator
 * had to look up and type. Anything missing is a 400 that changes nothing.
 *
 * Even with all four, the move is not taken on trust: lib/watcher.ts proves the
 * skipped range empty against the address index and the wallet's own balance
 * before it writes, and refuses with a reason if it cannot.
 */

import {fail, jsonOk, PRIVATE_CACHE, readJsonBody, requireAdmin, toResponse} from "@/lib/api";
import {
  fastForwardCursor,
  FAST_FORWARD_CONFIRM,
  watcherStatus,
  type FastForwardResult,
} from "@/lib/watcher";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    requireAdmin(req);
    return jsonOk(await watcherStatus(), PRIVATE_CACHE);
  } catch (err) {
    return toResponse(err, "admin-watcher");
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    requireAdmin(req);
    const body = await readJsonBody(req);

    // Naming the action in the body as well as the method: a stray POST from a
    // retried request or a copied curl line does nothing without it.
    if (body.action !== "fast-forward") {
      fail(400, 'action must be "fast-forward".');
    }
    if (body.confirm !== FAST_FORWARD_CONFIRM) {
      fail(400, `confirm must be exactly "${FAST_FORWARD_CONFIRM}".`);
    }

    // No default and no "to the head": the operator states the block, so the
    // decision is recorded in what they typed rather than in what the chain
    // happened to be doing when the request landed.
    const raw = typeof body.toBlock === "string" ? body.toBlock.trim() : "";
    if (!/^\d+$/.test(raw)) fail(400, "toBlock must be a whole block number, as a string.");

    const result: FastForwardResult = await fastForwardCursor({
      confirm: FAST_FORWARD_CONFIRM,
      toBlock: BigInt(raw),
    });

    // A refusal is a considered answer, not a server fault: 409, with the
    // reason the watcher gave, so the operator can act on it.
    return jsonOk(result, PRIVATE_CACHE, result.moved ? 200 : 409);
  } catch (err) {
    return toResponse(err, "admin-watcher");
  }
}
