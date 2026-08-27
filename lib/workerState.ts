/**
 * The distribution worker's single bookkeeping row (worker_state, id = 1).
 *
 * Shared by the worker, which writes it, and /admin, which reads it. Every
 * writer takes an optional query handle so the same call works standalone or
 * inside the distribution transaction; a carry or a block cursor that moved
 * without its credits being committed would silently lose value.
 */

import {sql, type SqlQuery} from "@/lib/db";
import {WORKER_STALL_SEC} from "@/lib/settings";

export type WorkerState = {
  startedAt: Date | null;
  /** Heartbeat. Moves every tick, including ticks that distribute nothing. */
  lastTickAt: Date | null;
  /** Only moves on a committed distribution. */
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  runNowAt: Date | null;
  lastError: string | null;
  pausedReason: string | null;
  /** swaps mode: last block whose SwapAccrued logs have been credited. */
  lastBlock: bigint | null;
  carryWei: bigint;
  publishedWei: bigint;
};

type StateRow = {
  started_at: Date | string | null;
  last_tick_at: Date | string | null;
  last_run_at: Date | string | null;
  next_run_at: Date | string | null;
  run_now_at: Date | string | null;
  last_error: string | null;
  paused_reason: string | null;
  last_block: string | number | null;
  carry_wei: string;
  published_wei: string;
};

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toWei(value: string | number | null): bigint {
  if (value === null || value === "") return 0n;
  return BigInt(value);
}

function shape(row: StateRow): WorkerState {
  return {
    startedAt: toDate(row.started_at),
    lastTickAt: toDate(row.last_tick_at),
    lastRunAt: toDate(row.last_run_at),
    nextRunAt: toDate(row.next_run_at),
    runNowAt: toDate(row.run_now_at),
    lastError: row.last_error,
    pausedReason: row.paused_reason,
    lastBlock: row.last_block === null ? null : BigInt(row.last_block),
    carryWei: toWei(row.carry_wei),
    publishedWei: toWei(row.published_wei),
  };
}

/* ------------------------------------------------------------------- read */

export async function readWorkerState(q: SqlQuery = sql): Promise<WorkerState | null> {
  const rows = await q<StateRow>`select * from worker_state where id = 1`;
  return rows[0] ? shape(rows[0]) : null;
}

/** Seconds since the last heartbeat, or null when the worker has never run. */
export function silentFor(state: WorkerState | null, now: Date = new Date()): number | null {
  if (!state?.lastTickAt) return null;
  return Math.max(0, Math.floor((now.getTime() - state.lastTickAt.getTime()) / 1000));
}

/**
 * Stall detection (spec 8.4). A worker that has never started is not stalled,
 * it is absent, and the caller reports that differently.
 */
export function isStalled(state: WorkerState | null, now: Date = new Date()): boolean {
  const silent = silentFor(state, now);
  return silent !== null && silent > WORKER_STALL_SEC;
}

/* ------------------------------------------------------------------ write */

/** Called once when the process comes up. */
export async function markStarted(q: SqlQuery = sql): Promise<void> {
  await q`
    insert into worker_state (id, started_at, last_tick_at)
    values (1, now(), now())
    on conflict (id) do update set started_at = now(), last_tick_at = now()
  `;
}

/** Heartbeat plus the time the current sleep ends. */
export async function markTick(nextRunAt: Date | null, q: SqlQuery = sql): Promise<void> {
  await q`update worker_state set last_tick_at = now(), next_run_at = ${nextRunAt} where id = 1`;
}

/**
 * Record a committed distribution. Called inside the distribution transaction,
 * so the cursor and the carry can never disagree with the credits.
 */
export async function markDistribution(
  patch: {carryWei?: bigint; lastBlock?: bigint | null},
  q: SqlQuery,
): Promise<void> {
  await q`
    update worker_state set
      last_run_at = now(),
      last_tick_at = now(),
      last_error = null,
      carry_wei = coalesce(${patch.carryWei?.toString() ?? null}::numeric, carry_wei),
      last_block = coalesce(${patch.lastBlock?.toString() ?? null}::bigint, last_block)
    where id = 1
  `;
}

/** swaps mode: advance the log cursor over a period that produced no credits. */
export async function setLastBlock(block: bigint, q: SqlQuery = sql): Promise<void> {
  await q`update worker_state set last_block = ${block.toString()}::bigint where id = 1`;
}

export async function setCarry(wei: bigint, q: SqlQuery = sql): Promise<void> {
  await q`update worker_state set carry_wei = ${wei.toString()}::numeric where id = 1`;
}

/** The cumulative total last accepted by SitowiseFactory.publishCredited. */
export async function setPublished(wei: bigint, q: SqlQuery = sql): Promise<void> {
  await q`update worker_state set published_wei = ${wei.toString()}::numeric where id = 1`;
}

export async function recordError(message: string | null, q: SqlQuery = sql): Promise<void> {
  await q`update worker_state set last_error = ${message}, last_tick_at = now() where id = 1`;
}

/** Non-null while a safety rail is holding distribution. Cleared by the worker. */
export async function setPausedReason(reason: string | null, q: SqlQuery = sql): Promise<void> {
  await q`update worker_state set paused_reason = ${reason} where id = 1`;
}

/* ---------------------------------------------------------------- run now */

/** /admin's "distribute now": leaves a flag the worker picks up within seconds. */
export async function requestRunNow(q: SqlQuery = sql): Promise<void> {
  await q`update worker_state set run_now_at = now() where id = 1`;
}

/**
 * Claim a pending request. Atomic, so two workers cannot both act on one click.
 */
export async function consumeRunNow(q: SqlQuery = sql): Promise<boolean> {
  const rows = await q<{id: number}>`
    update worker_state set run_now_at = null
    where id = 1 and run_now_at is not null
    returning id
  `;
  return rows.length > 0;
}
