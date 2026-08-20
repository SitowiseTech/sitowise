/**
 * One credit pass: put ETH on the balances of whichever nodes are due.
 *
 * This is the whole payout mechanism. `worker/index.ts` calls it in a loop and
 * `app/api/cron/credit` calls it once per request; both get the same pass, the
 * same rails and the same reported reason, so a deployment can move between a
 * long-running process and a scheduler without the behaviour changing.
 *
 * THE ORDER IS THE DESIGN:
 *
 *   1. Everything that can refuse the pass runs first, cheapest first, and each
 *      refusal carries a distinct reason string. There are no silent no-ops:
 *      /admin has to be able to say why nothing was paid.
 *   2. `creditBatch` is sent and its receipt awaited BEFORE a single row is
 *      written. If the chain call fails the timers are still in the past, so
 *      the next tick retries by itself and nothing was recorded that did not
 *      happen.
 *   3. Only after the receipt confirms do the ledger rows go in and the timers
 *      move, in one transaction.
 *
 * And the rule that keeps an outage from turning into a windfall: a node is
 * credited at most once per pass, and its next due time is measured from NOW,
 * never from when it was due. An hour of downtime is an hour without payouts,
 * not an hour of missed intervals paid out in one lump.
 */

import {clearAlert, raiseAlert} from "@/lib/alerts";
import {sql, tx} from "@/lib/db";
import type {DistMode} from "@/lib/env";
import {formatEthLabel} from "@/lib/format";
import {publicClient, readFactory} from "@/lib/onchain";
import {chainTotalNodes} from "@/lib/rpc";
import {
  advanceSchedules,
  deferAll,
  dueNodes,
  MAX_NODES_PER_TICK,
} from "@/lib/schedule";
import {loadSettings} from "@/lib/settings";
import {markDistribution, markTick, recordError, setPausedReason} from "@/lib/workerState";
import {randomDelaySec, randomWei, sum} from "@/worker/amounts";
import {checkDistributor, creditBatch, distributorAccount} from "@/worker/chain";
import {
  checkRails,
  gasMarginWei,
  modeAvailability,
  type RailReason,
  type Refusal,
} from "@/worker/policy";

/* ------------------------------------------------------------------- shape */

export type CreditSkipReason =
  | RailReason
  | "disabled"
  | "mode_unavailable"
  | "distributor_missing"
  | "distributor_mismatch"
  | "no_nodes_due"
  | "chain_unreadable"
  | "contract_paused"
  | "no_creditable_nodes"
  | "chain_call_failed";

export type CreditSkipped = {
  status: "skipped";
  reason: CreditSkipReason;
  message: string;
  detail?: Record<string, unknown>;
};

export type CreditCredited = {
  status: "credited";
  txHash: `0x${string}`;
  nodeCount: number;
  totalWei: bigint;
  /** Null when the chain call landed but the ledger write did not. */
  distributionId: number | null;
  /**
   * False means the money moved and the rows did not. The `credit_unrecorded`
   * alert carries everything needed to put it right by hand.
   */
  ledgerRecorded: boolean;
  /** Scheduled ids dropped before sending, as decimal strings. */
  droppedIds: string[];
};

export type CreditResult = CreditCredited | CreditSkipped;

export type CreditOptions = {
  /**
   * When the next pass is expected, for the heartbeat. The loop knows it from
   * its own interval; a cron caller knows it from its schedule.
   */
  nextRunAt?: Date | null;
};

function skip(
  reason: CreditSkipReason,
  message: string,
  detail?: Record<string, unknown>,
): CreditSkipped {
  return {status: "skipped", reason, message, detail};
}

function fromRefusal(refusal: Refusal<RailReason>): CreditSkipped {
  return {status: "skipped", reason: refusal.reason, message: refusal.message, detail: refusal.detail};
}

/** First line only. viem errors carry the whole request, which is not a summary. */
function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0];
}

/* ----------------------------------------------------------------- helpers */

type Candidate = {
  /** The id the contract knows. Chain calls speak only this one. */
  chainNodeId: bigint;
  /** The `nodes` row id. `credits.node_id` speaks only this one. */
  nodeId: number;
  amountWei: bigint;
};

/**
 * Ledger rows for the scheduled ids, keyed by chain id.
 *
 * Only active nodes: a retired node keeps its schedule row and its on-chain
 * balance, but it is not accruing any more, and crediting one would be a payout
 * nobody could explain.
 */
async function ledgerIdsFor(chainIds: readonly bigint[]): Promise<Map<string, number>> {
  const rows = await sql<{id: string | number; chain_node_id: string}>`
    select id, chain_node_id
      from nodes
     where status = 'active'
       and chain_node_id = any(${chainIds.map((id) => id.toString())}::numeric[])
  `;
  return new Map(rows.map((r) => [String(r.chain_node_id), Number(r.id)]));
}

/**
 * Record the timers moving forward without the ledger rows.
 *
 * Called only when the chain call succeeded and the transaction that should
 * have written the credits failed. Preventing a second payout for the same
 * interval matters more than the history row: the history can be reconstructed
 * from the transaction hash in the alert, a double credit cannot be taken back.
 */
async function salvageSchedules(
  entries: readonly Candidate[],
  minDelaySec: number,
  maxDelaySec: number,
): Promise<boolean> {
  try {
    await advanceSchedules(
      entries.map((entry) => ({
        nodeChainId: entry.chainNodeId,
        delaySeconds: randomDelaySec(minDelaySec, maxDelaySec),
      })),
    );
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------- pass */

export async function creditTick(opts: CreditOptions = {}): Promise<CreditResult> {
  const result = await runPass(opts);

  // The heartbeat moves on every completed pass, including one that credited
  // nothing. A worker that is up but idle must not look the same as a dead one.
  await markTick(opts.nextRunAt ?? null).catch(() => undefined);

  return result;
}

async function runPass(opts: CreditOptions): Promise<CreditResult> {
  const settings = await loadSettings();
  const config = settings.config;

  // Stored settings that had to be ignored are worth an alert on their own: the
  // console would otherwise show a value the worker is not acting on.
  if (settings.problems.length > 0) {
    await raiseAlert("config", settings.problems.join(" "));
  } else {
    await clearAlert("config");
  }

  /* -- refusals that need nothing but configuration ----------------------- */

  if (!config.enabled) {
    const message = "Distribution is switched off (DIST_ENABLED).";
    await setPausedReason(message);
    return skip("disabled", message);
  }

  const modeRefusal = modeAvailability(config.mode);
  if (modeRefusal) {
    await raiseAlert("swaps_unconfigured", modeRefusal.message, {
      severity: "stop",
      detail: modeRefusal.detail,
    });
    await setPausedReason(modeRefusal.message);
    return skip(modeRefusal.reason, modeRefusal.message, modeRefusal.detail);
  }
  await clearAlert("swaps_unconfigured");

  if (!distributorAccount()) {
    const message =
      "No distributor account is configured, so nothing can be credited. " +
      "DISTRIBUTOR_PRIVATE_KEY is the key that signs creditBatch and carries the payout float.";
    await setPausedReason(message);
    return skip("distributor_missing", message);
  }

  /* -- who is due --------------------------------------------------------- */

  // Before any RPC: with nothing due there is nothing to check the chain for,
  // and a tick every minute against an empty schedule should cost one query.
  const due = await dueNodes(MAX_NODES_PER_TICK);
  if (due.length === 0) {
    await setPausedReason(null);
    return skip("no_nodes_due", "No node timers have come up yet.");
  }

  /* -- chain state -------------------------------------------------------- */

  const chain = await readFactory();
  if (!chain.ok) {
    // Solvency cannot be checked without the contract balance, and crediting
    // blind is the thing that rail exists to prevent.
    const message = `Cannot read the factory, so solvency is unverifiable: ${chain.error}`;
    await raiseAlert("worker_error", message);
    await recordError(chain.error);
    return skip("chain_unreadable", message);
  }
  await clearAlert("worker_error");

  if (chain.data.paused) {
    const message = "The factory is paused, so no credits are being sent.";
    // Push the due timers out rather than letting every node pile up as
    // instantly due: the first pass after a long pause would otherwise be a
    // full MAX_NODES_PER_TICK batch that says nothing about how long the pause
    // lasted. Nobody loses a credit, because a missed interval is never owed.
    await deferAll(config.maxDelaySec);
    await setPausedReason(message);
    return skip("contract_paused", message);
  }

  // A key that is not the address the contract stores as `distributor` would
  // fail once per tick forever, and the balance check alone would not catch a
  // rotated role.
  const distributor = await checkDistributor(chain.data.distributor);
  if (!distributor.ok) {
    const message = `The configured distributor cannot credit: ${distributor.reason}`;
    await raiseAlert("worker_error", message, {severity: "stop"});
    await setPausedReason(message);
    return skip("distributor_mismatch", message);
  }

  /* -- which of the due nodes can actually be credited --------------------- */

  const dueIds = due.map((row) => BigInt(row.node_chain_id));

  // creditBatch reverts on the FIRST id the contract does not know, taking the
  // whole batch with it. One stray schedule row would therefore stall every
  // payout for every node, so unknown ids are dropped here and reported rather
  // than sent.
  //
  // The contract mints ids 1..totalNodes with no gaps and never deletes one, so
  // this bound is exactly equivalent to reading `nodeInfo(id).owner != 0` for
  // each of them, at one eth_call instead of two hundred.
  let totalNodes: bigint;
  try {
    totalNodes = await chainTotalNodes();
  } catch (err) {
    const message = `Cannot read totalNodes, so node ids cannot be validated: ${firstLine(err)}`;
    await raiseAlert("worker_error", message);
    await recordError(firstLine(err));
    return skip("chain_unreadable", message);
  }

  const ledgerIds = await ledgerIdsFor(dueIds);

  const candidates: Candidate[] = [];
  const droppedIds: string[] = [];
  for (const chainNodeId of dueIds) {
    const nodeId = ledgerIds.get(chainNodeId.toString());
    if (nodeId === undefined || chainNodeId < 1n || chainNodeId > totalNodes) {
      droppedIds.push(chainNodeId.toString());
      continue;
    }
    candidates.push({
      chainNodeId,
      nodeId,
      // A SEPARATE draw per node. One amount reused across the batch would put
      // every node on an identical payout curve, which is the whole thing the
      // per-node timers and per-node amounts exist to avoid.
      //
      // randomWei uses crypto.randomInt while the range fits its 2^48 limit —
      // the configured range is around 8e12 wei, so it does — and switches to
      // rejection sampling above it rather than assuming. Either path is
      // uniform and neither takes a modulo, which would bias the low end.
      amountWei: randomWei(config.minAmountWei, config.maxAmountWei),
    });
  }

  if (droppedIds.length > 0) {
    // These rows stay due and will be looked at again next pass; they are inert
    // rather than harmful, but they occupy a slot in every batch until someone
    // removes them, so they are worth a standing alert.
    await raiseAlert(
      "unknown_nodes",
      `${droppedIds.length} scheduled node id(s) are not active nodes the contract knows, ` +
        "so they were left out of the batch.",
      {detail: {ids: droppedIds.slice(0, 50), totalNodes: totalNodes.toString()}},
    );
  } else {
    await clearAlert("unknown_nodes");
  }

  if (candidates.length === 0) {
    const message = "Every node whose timer came up was dropped as unknown, so there is nothing to send.";
    await setPausedReason(message);
    return skip("no_creditable_nodes", message, {droppedIds});
  }

  /* -- rails -------------------------------------------------------------- */

  const totalWei = sum(candidates.map((c) => c.amountWei));

  const [credited24hWei, gasPriceWei] = await Promise.all([
    credited24h(),
    // Fail soft: a node that will not quote a gas price still lets the pass go
    // ahead, because the simulate step inside creditBatch is the real check on
    // whether the transaction can succeed.
    publicClient()
      .getGasPrice()
      .catch(() => 0n),
  ]);

  const refusal = checkRails({
    totalWei,
    nodeCount: candidates.length,
    credited24hWei,
    dailyCapWei: config.dailyCapWei,
    contractBalanceWei: chain.data.balanceWei,
    outstandingWei: chain.data.outstandingWei,
    distributorBalanceWei: distributor.balanceWei,
    gasMarginWei: gasMarginWei(candidates.length, gasPriceWei),
  });

  if (refusal) {
    const severity = refusal.reason === "insolvent" ? "stop" : "warn";
    const kind = refusal.reason === "insolvent" ? "low_liquidity" : refusal.reason;
    await raiseAlert(kind, refusal.message, {severity, detail: refusal.detail});
    // Same reasoning as the pause branch: these are operator conditions that
    // have nothing to do with any individual node's timer.
    await deferAll(config.maxDelaySec);
    await setPausedReason(refusal.message);
    return fromRefusal(refusal);
  }

  /* -- the chain call, before any write ----------------------------------- */

  let txHash: `0x${string}` | null;
  try {
    txHash = await creditBatch(
      candidates.map((c) => ({chainNodeId: c.chainNodeId, amountWei: c.amountWei})),
    );
  } catch (err) {
    const detail = firstLine(err);
    const message = `creditBatch failed, so nothing was credited or recorded: ${detail}`;
    await raiseAlert("worker_error", message, {severity: "stop", detail: {nodes: candidates.length}});
    await recordError(detail);
    // Timers are untouched and still in the past. The next pass retries on its
    // own; there is nothing to roll back because nothing was written.
    return skip("chain_call_failed", message);
  }

  if (txHash === null) {
    // Only reachable with an empty batch, which the guard above rules out.
    const message = "creditBatch had nothing to send.";
    await setPausedReason(null);
    return skip("no_creditable_nodes", message);
  }

  /* -- the ledger, only now ------------------------------------------------ */

  const mode: DistMode = config.mode;
  let distributionId: number | null = null;
  let ledgerRecorded = true;

  try {
    distributionId = await tx(async (q) => {
      const [row] = await q<{id: string}>`
        insert into distributions (mode, total_wei, node_count)
        values (${mode}, ${totalWei.toString()}::numeric, ${candidates.length})
        returning id
      `;
      const id = Number(row.id);

      await q`
        insert into credits (distribution_id, node_id, amount_wei)
        select ${id}::bigint, t.node_id, t.amount
          from unnest(
                 ${candidates.map((c) => c.nodeId)}::bigint[],
                 ${candidates.map((c) => c.amountWei.toString())}::numeric[]
               ) as t(node_id, amount)
      `;

      // Each node's next time is drawn separately and measured from now, which
      // is what keeps the nodes from re-synchronising into one group after a
      // pass that credited all of them together.
      await advanceSchedules(
        candidates.map((c) => ({
          nodeChainId: c.chainNodeId,
          delaySeconds: randomDelaySec(config.minDelaySec, config.maxDelaySec),
        })),
        q,
      );

      await markDistribution({}, q);
      return id;
    });
  } catch (err) {
    ledgerRecorded = false;
    const salvaged = await salvageSchedules(candidates, config.minDelaySec, config.maxDelaySec);
    await raiseAlert(
      "credit_unrecorded",
      `creditBatch ${txHash} credited ${formatEthLabel(totalWei)} to ${candidates.length} node(s), ` +
        `but the ledger write failed (${firstLine(err)}). The money is on chain; the history rows are not.` +
        (salvaged
          ? " The timers were moved forward separately, so the pass will not be repeated."
          : " The timers could NOT be moved, so the next pass may credit these nodes again."),
      {
        severity: "stop",
        detail: {
          tx: txHash,
          totalWei: totalWei.toString(),
          schedulesAdvanced: salvaged,
          credits: candidates.map((c) => ({
            chainNodeId: c.chainNodeId.toString(),
            nodeId: c.nodeId,
            amountWei: c.amountWei.toString(),
          })),
        },
      },
    ).catch(() => undefined);
    await recordError(`ledger write failed after ${txHash}`).catch(() => undefined);
  }

  if (ledgerRecorded) {
    await setPausedReason(null);
    await clearAlert("daily_cap");
    await clearAlert("distributor_float");
    await clearAlert("low_liquidity");
    await clearAlert("credit_unrecorded");
  }

  return {
    status: "credited",
    txHash,
    nodeCount: candidates.length,
    totalWei,
    distributionId,
    ledgerRecorded,
    droppedIds,
  };
}

/* ------------------------------------------------------------------ totals */

/**
 * Rolling 24 hour total, summed from `credits` rather than from
 * `distributions`. They should agree, and the per-credit rows are the ones the
 * cap is really about: a distribution row is a summary that a partially failed
 * write could leave behind without its credits.
 */
async function credited24h(): Promise<bigint> {
  const rows = await sql<{total: string}>`
    select coalesce(sum(amount_wei), 0)::text as total
      from credits
     where created_at > now() - interval '24 hours'
  `;
  return BigInt(rows[0]?.total ?? "0");
}
