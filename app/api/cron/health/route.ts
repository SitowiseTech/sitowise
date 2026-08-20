/**
 * Is the credit worker alive, and can it still pay?
 *
 * Public and unauthenticated, because everything in it is already public: the
 * contract's balance, what it owes, whether it is solvent and whether payouts
 * are switched on are all readable from the chain by anyone, and a node holder
 * has a fair claim to see them without an operator's key.
 *
 * What is deliberately NOT here: any address of a key-holding account, the
 * distributor's identity, alert detail, error text from the database or the
 * RPC. The distributor's balance is a number without a name attached, which
 * says "the float is running low" without saying where the float lives.
 */

import {distConfig, distTickSec} from "@/lib/env";
import {readFactory} from "@/lib/onchain";
import {dueCount, scheduledCount} from "@/lib/schedule";
import {watcherStatus} from "@/lib/watcher";
import {readWorkerState, silentFor} from "@/lib/workerState";
import {distributorBalance} from "@/worker/chain";

export const dynamic = "force-dynamic";

/**
 * Five minutes, per the spec. Passes run every DIST_TICK_SEC (60s by default),
 * so this is several missed passes rather than one slow one: a single tick lost
 * to a slow receipt or a cold start should not page anybody.
 */
export const CREDIT_STALE_SEC = 5 * 60;

/** Never let a CDN answer this; it is a liveness reading, not a document. */
const NO_STORE = {"cache-control": "no-store"};

/** A reading that failed is reported as null, never as a zero that looks measured. */
async function safe<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const [state, due, scheduled, chain, distributorWei, config, watcher] = await Promise.all([
    safe(() => readWorkerState()),
    safe(() => dueCount()),
    safe(() => scheduledCount()),
    safe(() => readFactory()),
    safe(() => distributorBalance()),
    // distConfig throws on a malformed value rather than guessing one, and a
    // health endpoint that 500s because a variable is misspelled is useless.
    safe(async () => distConfig()),
    // Payment discovery. A monitor that only watches the payout worker would
    // have reported this deployment perfectly healthy while it was 57,000
    // blocks behind on seeing anybody's money arrive.
    safe(() => watcherStatus()),
  ]);

  const secondsSinceLastTick = state ? silentFor(state) : null;

  const body = {
    lastTickAt: state?.lastTickAt ?? null,
    secondsSinceLastTick,
    // A worker that has never ticked is absent, not stale. Both are wrong, but
    // they are different problems and the monitor's message should say which.
    stale: secondsSinceLastTick === null ? true : secondsSinceLastTick > CREDIT_STALE_SEC,
    staleAfterSec: CREDIT_STALE_SEC,
    tickSec: safeNumber(distTickSec),

    distEnabled: config?.enabled ?? null,
    distMode: config?.mode ?? null,

    paused: chain?.ok ? chain.data.paused : null,
    dueNodes: due,
    scheduledNodes: scheduled,

    // Nothing here names the payments wallet or quotes an upstream error body:
    // it says whether discovery is working and by how much it is behind, which
    // is all a monitor can act on.
    paymentDiscovery: {
      ok: watcher === null ? null : watcher.explorerOk && Number(watcher.behindBlocks) <= 1_200,
      explorerOk: watcher?.explorerOk ?? null,
      behindBlocks: watcher?.behindBlocks ?? null,
      behindSeconds: watcher?.behindSeconds ?? null,
      indexLagBlocks: watcher?.indexLagBlocks ?? null,
      pendingPayments: watcher?.pendingPayments ?? null,
    },

    distributorBalanceWei: distributorWei === null ? null : distributorWei.toString(),
    contractBalanceWei: chain?.ok ? chain.data.balanceWei.toString() : null,
    outstandingWei: chain?.ok ? chain.data.outstandingWei.toString() : null,
    isSolvent: chain?.ok ? chain.data.isSolvent : null,
  };

  return Response.json(body, {status: 200, headers: NO_STORE});
}

function safeNumber(read: () => number): number | null {
  try {
    return read();
  } catch {
    return null;
  }
}
