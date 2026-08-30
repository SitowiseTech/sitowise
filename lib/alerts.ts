/**
 * Operational alerts (spec 8.4, listed by spec 14).
 *
 * The worker raises them, the worker clears them when the condition lifts, and
 * a human can close one from /admin. One open row per kind: a condition that
 * repeats every ninety seconds must refresh its row rather than write a
 * thousand a day, which is what the partial unique index in
 * db/002_worker_admin.sql is for.
 *
 * `worker_silent` is deliberately not in this table. A worker that is down
 * cannot write a row saying so, so /admin derives it from the heartbeat.
 */

import {sql, type SqlQuery} from "@/lib/db";

export type AlertKind =
  /** Contract balance cannot cover what node holders are already owed. */
  | "low_liquidity"
  /** Rolling 24h total would pass DIST_DAILY_CAP_WEI. */
  | "daily_cap"
  /** The distributor account cannot cover the next batch plus its gas. */
  | "distributor_float"
  /**
   * creditBatch landed but the matching ledger rows did not. The money moved,
   * so this is the one alert that means "go and reconcile by hand"; the detail
   * carries the transaction hash and every id and amount in the batch.
   */
  | "credit_unrecorded"
  /** Scheduled ids the contract or the ledger does not know, dropped from the batch. */
  | "unknown_nodes"
  /** DIST_MODE=swaps, which has no chain source to read since the hook was removed. */
  | "swaps_unconfigured"
  /**
   * The payment watcher cannot see incoming transfers: the address index is
   * down, behind, or disagreeing with the chain. Money may be arriving unseen,
   * which is why a blind pass writes this rather than reporting a quiet zero.
   */
  | "payment_discovery"
  /** Stored settings that had to be ignored. */
  | "config"
  /**
   * A stored tier setting could not be used, or two tiers share a price. Loud
   * because a price nobody meant would park every payment sent against it.
   */
  | "tier_config"
  /**
   * Payments the chain has and the ledger does not. Discovery only moves
   * forward, so a range walked past is never revisited; this is the audit that
   * notices, and it has already recovered what it names.
   */
  | "missed_payments"
  /** Anything the loop threw. */
  | "worker_error";

export type AlertSeverity = "warn" | "stop";

export type Alert = {
  id: number;
  kind: string;
  severity: AlertSeverity;
  message: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

type AlertRow = {
  id: string | number;
  kind: string;
  severity: string;
  message: string;
  detail: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_at: Date | string | null;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function shape(row: AlertRow): Alert {
  return {
    id: Number(row.id),
    kind: row.kind,
    severity: row.severity === "stop" ? "stop" : "warn",
    message: row.message,
    detail: row.detail,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    resolvedAt: row.resolved_at === null ? null : toDate(row.resolved_at),
  };
}

/**
 * Raise or refresh the open alert of this kind. `detail` carries the numbers
 * behind the sentence; wei belongs in it as a decimal string, never a JS number.
 */
export async function raiseAlert(
  kind: AlertKind,
  message: string,
  opts: {severity?: AlertSeverity; detail?: Record<string, unknown>} = {},
  q: SqlQuery = sql,
): Promise<void> {
  const detail = opts.detail ? JSON.stringify(opts.detail) : null;
  await q`
    insert into alerts (kind, severity, message, detail)
    values (${kind}, ${opts.severity ?? "warn"}, ${message}, ${detail}::jsonb)
    on conflict (kind) where resolved_at is null
    do update set
      severity = excluded.severity,
      message = excluded.message,
      detail = excluded.detail,
      updated_at = now()
  `;
}

/** Clear the open alert of a kind. Safe to call when there is none. */
export async function clearAlert(kind: AlertKind, q: SqlQuery = sql): Promise<void> {
  await q`update alerts set resolved_at = now(), updated_at = now() where kind = ${kind} and resolved_at is null`;
}

/** Close one row by id, for the button in /admin. */
export async function resolveAlertById(id: number, q: SqlQuery = sql): Promise<boolean> {
  const rows = await q<{id: string}>`
    update alerts set resolved_at = now(), updated_at = now()
    where id = ${id} and resolved_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function openAlerts(q: SqlQuery = sql): Promise<Alert[]> {
  const rows = await q<AlertRow>`
    select * from alerts where resolved_at is null
    order by (severity = 'stop') desc, created_at desc
  `;
  return rows.map(shape);
}

/** Open rows first, then recently closed ones, so /admin can show the history. */
export async function recentAlerts(limit = 20, q: SqlQuery = sql): Promise<Alert[]> {
  const rows = await q<AlertRow>`
    select * from alerts
    order by (resolved_at is null) desc, coalesce(resolved_at, updated_at) desc
    limit ${limit}
  `;
  return rows.map(shape);
}
