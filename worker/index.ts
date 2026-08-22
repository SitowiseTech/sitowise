/**
 * The credit worker as a standalone process.
 *
 *   npm run worker
 *
 * It is a thin loop around `creditTick()` from lib/credit.ts, and that is the
 * point: the same pass runs whether it is driven from here or from
 * `POST /api/cron/credit`, so a deployment can be moved from a scheduler to a
 * supervised process (or run both, one idle) without the rails, the reasons or
 * the ledger writes changing at all.
 *
 * What this file adds over the route is only what a process can do that a
 * request cannot: survive between passes, pick up an /admin "distribute now"
 * within seconds, keep the heartbeat fresh while it sleeps, and shut down
 * cleanly on a signal.
 *
 * No pass failure stops the process. A worker that exits on the first transient
 * RPC error is a worker that is down exactly when it matters.
 */

import "@/worker/loadEnv";

import {raiseAlert} from "@/lib/alerts";
import {creditTick} from "@/lib/credit";
import {closePool, withAdvisoryLock} from "@/lib/db";
import {databaseUrl} from "@/lib/env";
import {formatEthLabel} from "@/lib/format";
import {loadSettings} from "@/lib/settings";
import {
  consumeRunNow,
  isStalled,
  markStarted,
  markTick,
  readWorkerState,
  recordError,
  silentFor,
} from "@/lib/workerState";
import {checkDistributor, distributorAccount} from "@/worker/chain";
import {workerConfig, type WorkerConfig} from "@/worker/config";
import {errorMessage, log} from "@/worker/log";
import {readFactory} from "@/lib/onchain";

/**
 * The same lock the cron route takes. Running both at once is a supported
 * configuration precisely because this key is shared: whichever gets there
 * first does the pass and the other reports that it was busy.
 */
const CREDIT_LOCK = 918273;

let stopping = false;
/** Set while the loop is asleep, so a signal does not wait out the timer. */
let wake: (() => void) | null = null;

/* ---------------------------------------------------------------- sleeping */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

type Wake = "elapsed" | "run_now" | "stopped";

async function sleepUntil(endsAt: number, cfg: WorkerConfig): Promise<Wake> {
  let lastBeat = Date.now();
  while (!stopping) {
    const remaining = endsAt - Date.now();
    if (remaining <= 0) return "elapsed";
    await delay(Math.min(cfg.pollMs, remaining));
    if (stopping) return "stopped";

    if (Date.now() - lastBeat >= cfg.heartbeatMs) {
      lastBeat = Date.now();
      await markTick(new Date(endsAt)).catch((err) =>
        log.warn("heartbeat failed", {error: errorMessage(err)}),
      );
    }
    if (await consumeRunNow().catch(() => false)) return "run_now";
  }
  return "stopped";
}

/* -------------------------------------------------------------------- pass */

async function runOnce(cfg: WorkerConfig): Promise<void> {
  const nextRunAt = new Date(Date.now() + cfg.tickSec * 1000);
  const attempt = await withAdvisoryLock(CREDIT_LOCK, () => creditTick({nextRunAt}));

  if (!attempt.ran) {
    // Something else holds the lock: another instance, or the cron route. Not
    // an error, and not something to retry immediately.
    log.info("a credit pass is already running elsewhere, skipping this one");
    return;
  }

  const result = attempt.result;
  if (result.status === "skipped") {
    log.info("no credits this pass", {reason: result.reason, message: result.message});
    return;
  }

  log.info("credited", {
    nodes: result.nodeCount,
    total: formatEthLabel(result.totalWei),
    tx: result.txHash,
    distribution: result.distributionId ?? "unrecorded",
    dropped: result.droppedIds.length || undefined,
  });

  if (!result.ledgerRecorded) {
    log.error("the credit landed on chain but the ledger write failed", {tx: result.txHash});
  }
}

/* -------------------------------------------------------------------- boot */

/**
 * Say plainly, once, whether this process can actually pay anything. It does
 * not refuse to start: the key or the RPC may come back, and a worker that
 * exits on a bad start needs a human where one that reports and keeps trying
 * does not.
 */
async function preflight(): Promise<void> {
  if (!distributorAccount()) {
    log.warn(
      "DISTRIBUTOR_PRIVATE_KEY is not set. Every pass will report distributor_missing and credit nothing.",
    );
    return;
  }

  const chain = await readFactory();
  if (!chain.ok) {
    log.warn("could not reach the chain at startup, the loop will retry", {error: chain.error});
    return;
  }

  const check = await checkDistributor(chain.data.distributor);
  if (!check.ok) {
    log.error("the distributor key cannot credit", {reason: check.reason});
    return;
  }

  // creditBatch is payable, so this balance is both the gas budget and the
  // money being paid out.
  log.info("distributor ready", {address: check.address, float: formatEthLabel(check.balanceWei)});
  if (check.balanceWei === 0n) {
    log.warn("the distributor holds no ETH, so every pass will stop on distributor_float");
  }
}

async function main(): Promise<void> {
  const cfg = workerConfig();
  databaseUrl(); // Fails here with a readable message rather than mid-transaction.

  const previous = await readWorkerState();
  if (isStalled(previous)) {
    log.warn("the previous worker stopped without shutting down", {silentForSec: silentFor(previous)});
  }
  await markStarted();

  const settings = await loadSettings();
  log.info("credit worker started", {
    mode: settings.config.mode,
    enabled: settings.config.enabled,
    tick: `${cfg.tickSec}s`,
    perNodeDelay: `${settings.config.minDelaySec}-${settings.config.maxDelaySec}s`,
    amount: `${formatEthLabel(settings.config.minAmountWei)} to ${formatEthLabel(settings.config.maxAmountWei)}`,
    dailyCap: formatEthLabel(settings.config.dailyCapWei),
    overridden: settings.overridden.join(",") || "none",
  });

  await preflight();

  while (!stopping) {
    const endsAt = Date.now() + cfg.tickSec * 1000;
    await markTick(new Date(endsAt)).catch((err) => log.warn("heartbeat failed", {error: errorMessage(err)}));

    const woke = await sleepUntil(endsAt, cfg);
    if (stopping || woke === "stopped") break;
    if (woke === "run_now") log.info("crediting now at the operator's request");

    try {
      await runOnce(cfg);
    } catch (err) {
      const message = errorMessage(err);
      log.error("pass failed", {error: message});
      await recordError(message).catch(() => undefined);
      await raiseAlert("worker_error", `The credit loop threw: ${message}`).catch(() => undefined);
    }
  }
}

function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", {signal});
  wake?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main()
  .catch((err) => {
    log.error("worker stopped", {error: errorMessage(err)});
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => undefined);
    log.info("stopped");
  });
