/**
 * The credit pass, triggered by a scheduler.
 *
 * POST and GET both run it. That is not laziness: several hosted cron services
 * only issue GET, and a pass that can only be started one way is a pass that
 * silently never runs on half of them. The secret is what gates it, not the
 * method.
 *
 * Everything this route does beyond authentication and locking lives in
 * lib/credit.ts, so the scheduled pass and the standalone worker cannot drift
 * apart in what they consider safe.
 */

import {timingSafeEqual} from "node:crypto";
import {creditTick, type CreditResult} from "@/lib/credit";
import {withAdvisoryLock} from "@/lib/db";
import {cronKey, distTickSec, hasCronKey} from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * The pass sends a transaction and waits for its receipt (up to 120s in
 * worker/chain.ts), and the ledger rows are written after that receipt lands.
 * A function killed in between would leave credited ETH with no history row, so
 * the ceiling is set well above the receipt timeout rather than near it.
 */
export const maxDuration = 300;

/** Chosen once and fixed: two passes crediting the same due nodes would pay twice. */
const CREDIT_LOCK = 918273;

const NO_STORE = {"cache-control": "private, no-store"};

function unauthorized(): Response {
  // No detail. A caller that got the secret wrong learns only that.
  return Response.json({error: "Not authorised."}, {status: 401, headers: NO_STORE});
}

/**
 * Constant-time comparison of the presented key.
 *
 * timingSafeEqual throws on a length mismatch, so the lengths are compared
 * first and the comparison is skipped when they differ. That leaks the length
 * of the key and nothing else, which is not worth defending: a secret whose
 * length is the only thing still unknown is already lost.
 */
function authorised(req: Request): boolean {
  if (!hasCronKey()) {
    // Fail closed. A credit route that runs without a secret spends real ETH
    // for anyone who finds the URL.
    console.error("[cron:credit] CRON_KEY is not set, so every request is refused.");
    return false;
  }

  const provided = Buffer.from(req.headers.get("x-cron-key") ?? "", "utf8");
  const expected = Buffer.from(cronKey(), "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** The pass, as JSON. Wei is a decimal string; nothing here loses precision. */
function summarise(result: CreditResult): Record<string, unknown> {
  if (result.status === "skipped") {
    return {
      ran: true,
      credited: false,
      reason: result.reason,
      message: result.message,
      detail: result.detail ?? null,
    };
  }

  return {
    ran: true,
    credited: true,
    nodes: result.nodeCount,
    totalWei: result.totalWei.toString(),
    txHash: result.txHash,
    distributionId: result.distributionId,
    ledgerRecorded: result.ledgerRecorded,
    droppedIds: result.droppedIds,
  };
}

async function handle(req: Request): Promise<Response> {
  if (!authorised(req)) return unauthorized();

  try {
    const nextRunAt = new Date(Date.now() + distTickSec() * 1000);

    // A pass that overlaps the previous one is normal on a slow chain, not an
    // error: the scheduler fires on a fixed cadence and a receipt can take
    // longer than the gap. Report it and let the scheduler move on.
    const attempt = await withAdvisoryLock(CREDIT_LOCK, () => creditTick({nextRunAt}));

    if (!attempt.ran) {
      return Response.json(
        {ran: false, reason: "locked", message: "A credit pass is already running."},
        {status: 200, headers: NO_STORE},
      );
    }

    return Response.json(summarise(attempt.result), {status: 200, headers: NO_STORE});
  } catch (err) {
    // Never a stack trace in the body. The detail goes to the server log, where
    // it belongs, and the scheduler gets a 500 it can alert on.
    console.error("[cron:credit]", err);
    return Response.json(
      {ran: false, error: "The credit pass failed. Check the server log."},
      {status: 500, headers: NO_STORE},
    );
  }
}

export function POST(req: Request): Promise<Response> {
  return handle(req);
}

export function GET(req: Request): Promise<Response> {
  return handle(req);
}
