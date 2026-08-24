/**
 * POST /api/admin/reconcile  { fromBlock?, toBlock?, maxNodes? }  ->  ReconcileResult
 * GET  /api/admin/reconcile                                       ->  same, no body
 *
 * Runs the section 11 reconciler: read NodeMinted from the chain, insert every
 * node the ledger is missing. A node that is not in the ledger receives nothing
 * from the distribution worker, so this is what stops a mint made outside the
 * site, or one whose sync call was lost, from sitting dead forever.
 *
 * Behind `x-admin-key`, and reports 404 when no ADMIN_KEY is configured. Meant
 * to be called on a timer every few minutes; it is idempotent and cheap when
 * there is nothing to do.
 *
 * The result distinguishes what was inserted from what could not be resolved.
 * Nothing is ever inserted on a guess: a node whose mint log was not found is
 * reported under `unresolved` and picked up on a later run.
 */

import {
  checkLimit,
  jsonOk,
  mergeHeaders,
  parseBlockNumber,
  parseBoundedInt,
  PRIVATE_CACHE,
  readJsonBody,
  requireAdmin,
  toResponse,
} from "@/lib/api";
import {reconcileNodes, type ReconcileResult} from "@/lib/reconcile";

export const maxDuration = 60;

async function run(req: Request, withBody: boolean): Promise<Response> {
  const limit = checkLimit(req, "admin-reconcile", {limit: 10});
  if (limit.blocked) return limit.blocked;

  try {
    requireAdmin(req);

    // readJsonBody treats an empty body as {}, so a cron job can POST nothing.
    const body: Record<string, unknown> = withBody ? await readJsonBody(req) : {};

    const result: ReconcileResult = await reconcileNodes({
      fromBlock: parseBlockNumber(body.fromBlock, "fromBlock"),
      toBlock: parseBlockNumber(body.toBlock, "toBlock"),
      maxNodes: parseBoundedInt(body.maxNodes, "maxNodes", {fallback: 50, min: 1, max: 500}),
    });

    return jsonOk(result, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "admin-reconcile", limit.headers);
  }
}

export function POST(req: Request): Promise<Response> {
  return run(req, true);
}

export function GET(req: Request): Promise<Response> {
  return run(req, false);
}
