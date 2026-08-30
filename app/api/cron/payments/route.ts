/**
 * POST /api/cron/payments  ->  PaymentsPassResult
 * GET  /api/cron/payments  ->  same
 *
 * One pass of the payment pipeline: hand back rows a dead process left behind,
 * ask the address index for transfers to the payments wallet and verify each one
 * against the chain, mint a node for each payment that checks out. Everything it
 * does is idempotent, so the worst case for calling it too often is wasted
 * requests, and the worst case for calling it too rarely is a buyer waiting.
 *
 * GET as well as POST because several hosted schedulers only issue GET. Both do
 * exactly the same work; there is no body to send.
 *
 * Behind `x-cron-key` (or `authorization: Bearer`), 404 when no CRON_KEY is
 * configured — an unconfigured cron surface should not advertise that it exists.
 *
 * Run it every minute or two. Ground not covered in one pass is covered in the
 * next, and the response says how far behind the head it still is — and, in
 * `degraded`, whether discovery is working at all.
 */

import {jsonOk, PRIVATE_CACHE, requireCron, toResponse} from "@/lib/api";
import {withAdvisoryLock} from "@/lib/db";
import {watcherConfig} from "@/lib/env";
import {runMintRelay, type MintRelayResult} from "@/lib/mintRelay";
import {requeueStuckMinting} from "@/lib/payments";
import {maybeAuditPayments, scanPayments, type AuditResult, type WatcherScan} from "@/lib/watcher";

export const dynamic = "force-dynamic";

/**
 * The platform ceiling, not the target. The budgets below aim well under it:
 * hosted schedulers commonly give up at 30 seconds, and a run the scheduler
 * abandons is a run that never reports what it did.
 */
export const maxDuration = 60;

/**
 * Its own lock. The credit worker holds 918273; sharing it would make a slow
 * distribution round block every payment from being seen, and the two have
 * nothing in common but a database.
 */
const PAYMENTS_LOCK = 918274;

/**
 * The whole pass aims to answer inside this, comfortably under the 30 second
 * timeout of the schedulers that call it. It is affordable now: discovery is one
 * index query for the entire range rather than one RPC call per block, so the
 * cost of a pass no longer grows with how far behind the cursor is.
 */
const PASS_BUDGET_MS = 22_000;
/** Reserved out of that for minting, which sends transactions and waits for them. */
const MINT_RESERVE_MS = 10_000;

export type PaymentsPassResult = {
  /** False when another pass held the lock. Not an error: the other pass is doing it. */
  ran: boolean;
  durationMs: number;
  /** Rows a dead process left in `minting` and this pass handed back. */
  requeued?: number;
  blocksScanned?: number;
  /** Payments recorded by this pass, wrong amounts included. */
  paymentsSeen?: number;
  minted?: number;
  failed?: number;
  manualReview?: number;
  /** Present only on passes where the audit was due. */
  audit?: {checked: number; missing: number; adopted: number};
  /** True when the watcher is level with the head and nothing is waiting to mint. */
  caughtUp?: boolean;
  /**
   * True when payment discovery itself is not working. Separate from `caughtUp`
   * on purpose: a pass that saw nothing because it was blind must not read the
   * same as a pass that saw nothing because there was nothing.
   */
  degraded?: boolean;
  degradedReason?: string | null;
  scan?: WatcherScan;
  mint?: MintRelayResult;
};

async function run(req: Request): Promise<Response> {
  const started = Date.now();

  try {
    // Before any database or chain work: an unauthenticated caller must not be
    // able to make this route spend a single RPC request.
    requireCron(req);

    const cfg = watcherConfig();

    const outcome = await withAdvisoryLock(PAYMENTS_LOCK, async () => {
      // First, because a row stuck in `minting` is invisible to claimForMinting
      // and would otherwise sit there until someone noticed by hand.
      const requeued = await requeueStuckMinting(cfg.stuckAfterSec);

      // Then the scan, which is what puts payments on the queue. Minting reads
      // that queue, so scanning first means a payment made a second ago can
      // still become a node in this same pass.
      const elapsed = () => Date.now() - started;
      const scan = await scanPayments({
        budgetMs: Math.max(1_000, PASS_BUDGET_MS - elapsed() - MINT_RESERVE_MS),
      });

      const mint = await runMintRelay({
        limit: cfg.mintBatch,
        budgetMs: Math.max(1_000, PASS_BUDGET_MS - elapsed()),
      });

      // Last, and only when it is due. It answers "did discovery walk past
      // anybody's money", which is worth knowing after the pass has done its
      // ordinary work rather than instead of it.
      const audit = await maybeAuditPayments().catch(() => null);

      return {requeued, scan, mint, audit};
    });

    if (!outcome.ran) {
      // An overlapping run is the normal state of a job that runs every minute
      // and occasionally takes longer than a minute. 200, not 409.
      return jsonOk<PaymentsPassResult>(
        {ran: false, durationMs: Date.now() - started},
        PRIVATE_CACHE,
      );
    }

    const {requeued, scan, mint, audit} = outcome.result;

    return jsonOk<PaymentsPassResult>(
      {
        ran: true,
        durationMs: Date.now() - started,
        requeued,
        blocksScanned: scan.blocksScanned,
        paymentsSeen: scan.recorded,
        minted: mint.minted + mint.alreadyMinted,
        failed: mint.failed,
        manualReview: scan.manualReview + mint.manualReview,
        ...(audit
          ? {audit: {checked: audit.checked, missing: audit.missing, adopted: audit.adopted.length}}
          : {}),
        caughtUp: scan.caughtUp && !mint.more,
        degraded: scan.degraded,
        degradedReason: scan.degradedReason,
        scan,
        mint,
      },
      PRIVATE_CACHE,
    );
  } catch (err) {
    // toResponse logs the detail server-side and returns one sentence. Nothing
    // from a key, a query or a stack ever reaches the scheduler's logs.
    return toResponse(err, "cron-payments");
  }
}

export function POST(req: Request): Promise<Response> {
  return run(req);
}

export function GET(req: Request): Promise<Response> {
  return run(req);
}
