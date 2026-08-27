/**
 * Runtime distribution settings.
 *
 * Spec 8.3 puts every distribution number in the environment, and env stays the
 * source of truth for a fresh deployment. What env cannot do is stop a running
 * distribution from a web page: the worker is a separate long-lived process,
 * often on another host, and nothing a request handler writes to
 * `process.env` reaches it. So /admin writes to the `settings` table
 * (db/002_worker_admin.sql) and the worker reads env first, then lets a stored
 * row override it. No row means the env value is in force.
 *
 * Wei amounts are stored as wei, not as decimal ETH, so a value cannot change
 * meaning by passing through a float on the way in or out.
 */

import {sql} from "@/lib/db";
import {distConfig, type DistConfig, type DistMode} from "@/lib/env";

/** Every field of DistConfig is tunable; the keys are the settings-table rows. */
export type DistField = keyof DistConfig;

export const SETTING_KEY: Record<DistField, string> = {
  enabled: "dist.enabled",
  mode: "dist.mode",
  minDelaySec: "dist.min_delay_sec",
  maxDelaySec: "dist.max_delay_sec",
  minAmountWei: "dist.min_amount_wei",
  maxAmountWei: "dist.max_amount_wei",
  dailyCapWei: "dist.daily_cap_wei",
};

const FIELDS = Object.keys(SETTING_KEY) as DistField[];

/** Treat a worker as stalled once its heartbeat is this old (spec 8.4). */
export const WORKER_STALL_SEC = 15 * 60;

export type ResolvedSettings = {
  /** What the worker should act on: env, with stored rows applied on top. */
  config: DistConfig;
  /** Env alone, so /admin can show what a stored row is replacing. */
  fromEnv: DistConfig;
  /** Fields currently overridden in the database. */
  overridden: DistField[];
  /** Stored values that had to be ignored. Empty in a healthy deployment. */
  problems: string[];
};

/* --------------------------------------------------------------- coercion */

function parseBool(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`expected true or false, got "${raw}"`);
}

function parseMode(raw: string): DistMode {
  const v = raw.trim().toLowerCase();
  if (v === "treasury" || v === "swaps") return v;
  throw new Error(`expected treasury or swaps, got "${raw}"`);
}

function parseCount(raw: string): number {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`expected a whole number, got "${raw}"`);
  return Number(raw.trim());
}

function parseWei(raw: string): bigint {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`expected an integer wei amount, got "${raw}"`);
  return BigInt(raw.trim());
}

/** Text form of a value, as it is stored and as the admin API accepts it. */
export function encodeValue(value: DistConfig[DistField]): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

/** Parse one stored or submitted value into its typed form. Throws on garbage. */
export function decodeField(field: DistField, raw: string): DistConfig[DistField] {
  switch (field) {
    case "enabled":
      return parseBool(raw);
    case "mode":
      return parseMode(raw);
    case "minDelaySec":
    case "maxDelaySec":
      return parseCount(raw);
    case "minAmountWei":
    case "maxAmountWei":
    case "dailyCapWei":
      return parseWei(raw);
  }
}

export function isDistField(key: string): key is DistField {
  return (FIELDS as string[]).includes(key);
}

/* ------------------------------------------------------------- invariants */

/**
 * Enforce the relationships env validation already enforces (min <= max, no
 * zeroes). A merged config can break them even when each half was fine on its
 * own, so any offending field falls back to its env value and says so rather
 * than letting the worker run on a nonsense range.
 */
function reconcile(merged: DistConfig, fromEnv: DistConfig): {config: DistConfig; problems: string[]} {
  const config = {...merged};
  const problems: string[] = [];

  if (config.minDelaySec < 1) {
    problems.push(`Stored ${SETTING_KEY.minDelaySec} is below 1 second; using the environment value.`);
    config.minDelaySec = fromEnv.minDelaySec;
  }
  if (config.maxDelaySec < config.minDelaySec) {
    problems.push(`Stored delay range is inverted (${config.minDelaySec}s to ${config.maxDelaySec}s); using the environment values.`);
    config.minDelaySec = fromEnv.minDelaySec;
    config.maxDelaySec = fromEnv.maxDelaySec;
  }
  if (config.minAmountWei <= 0n) {
    problems.push(`Stored ${SETTING_KEY.minAmountWei} is zero; using the environment value.`);
    config.minAmountWei = fromEnv.minAmountWei;
  }
  if (config.maxAmountWei < config.minAmountWei) {
    problems.push("Stored amount range is inverted; using the environment values.");
    config.minAmountWei = fromEnv.minAmountWei;
    config.maxAmountWei = fromEnv.maxAmountWei;
  }
  if (config.dailyCapWei <= 0n) {
    problems.push(`Stored ${SETTING_KEY.dailyCapWei} is zero; using the environment value.`);
    config.dailyCapWei = fromEnv.dailyCapWei;
  }

  return {config, problems};
}

/** Same checks, but as a rejection: used before anything is written. */
export function validateConfig(config: DistConfig): string | null {
  if (config.minDelaySec < 1) return "Minimum interval must be at least 1 second.";
  if (config.maxDelaySec < config.minDelaySec) return "Maximum interval must be at least the minimum.";
  if (config.minAmountWei <= 0n) return "Minimum amount must be greater than zero.";
  if (config.maxAmountWei < config.minAmountWei) return "Maximum amount must be at least the minimum.";
  if (config.dailyCapWei <= 0n) return "Daily cap must be greater than zero.";
  return null;
}

/* ------------------------------------------------------------------- read */

export async function loadSettings(): Promise<ResolvedSettings> {
  const fromEnv = distConfig();
  const rows = await sql<{key: string; value: string}>`
    select key, value from settings where key like 'dist.%'
  `;

  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const merged = {...fromEnv} as Record<DistField, DistConfig[DistField]>;
  const overridden: DistField[] = [];
  const problems: string[] = [];

  for (const field of FIELDS) {
    const raw = stored.get(SETTING_KEY[field]);
    if (raw === undefined) continue;
    try {
      merged[field] = decodeField(field, raw);
      overridden.push(field);
    } catch (err) {
      problems.push(`Stored ${SETTING_KEY[field]} is unusable (${(err as Error).message}); using the environment value.`);
    }
  }

  const reconciled = reconcile(merged as DistConfig, fromEnv);
  return {
    config: reconciled.config,
    fromEnv,
    overridden,
    problems: [...problems, ...reconciled.problems],
  };
}

/* ------------------------------------------------------------------ write */

/**
 * Persist overrides. Only the fields present in `patch` are touched, so the
 * caller can change one toggle without freezing the rest of the config into
 * the table.
 */
export async function saveSettings(patch: Partial<DistConfig>, actor: string): Promise<void> {
  const entries = (Object.keys(patch) as DistField[]).filter((f) => patch[f] !== undefined);
  if (entries.length === 0) return;

  const keys = entries.map((f) => SETTING_KEY[f]);
  const values = entries.map((f) => encodeValue(patch[f] as DistConfig[DistField]));

  await sql`
    insert into settings (key, value, updated_by)
    select k, v, ${actor}::text from unnest(${keys}::text[], ${values}::text[]) as t(k, v)
    on conflict (key) do update
      set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
  `;
}

/** Drop overrides so the listed fields fall back to env. Empty list clears all. */
export async function clearSettings(fields: DistField[] = []): Promise<void> {
  const keys = fields.length > 0 ? fields.map((f) => SETTING_KEY[f]) : Object.values(SETTING_KEY);
  await sql`delete from settings where key = any(${keys}::text[])`;
}
