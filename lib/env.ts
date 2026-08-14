/**
 * Every environment variable the app reads (spec section 17), in one place.
 *
 * Access is by function call, never by module-level constant. `next build`
 * imports route modules to collect their metadata, and a build machine has no
 * runtime secrets: reading at call time turns a missing DATABASE_URL into a
 * clear request-time error instead of a failed build.
 *
 * Server-only. The two NEXT_PUBLIC_* readers are here so the values are
 * validated in one place; the client gets them through lib/chain.ts.
 */

import {parseEth} from "@/lib/format";
import {CHAIN_ID, FACTORY_ADDRESS} from "@/lib/chain";

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** 0.02 ETH, the launch price. Overridden by NODE_PRICE_WEI. */
const DEFAULT_NODE_PRICE_WEI = "20000000000000000";

/* ------------------------------------------------------------------ readers */

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function required(name: string, hint: string): string {
  const value = read(name);
  if (value === undefined) throw new EnvError(`${name} is not set. ${hint}`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = read(name);
  if (value === undefined) return fallback;
  const v = value.toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  throw new EnvError(`${name} must be true or false, got "${value}"`);
}

function int(name: string, fallback: number): number {
  const value = read(name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new EnvError(`${name} must be a whole number, got "${value}"`);
  return Number(value);
}

/** Decimal ETH in env, wei everywhere in code. */
function wei(name: string, fallback: string): bigint {
  const value = read(name) ?? fallback;
  try {
    return parseEth(value);
  } catch {
    throw new EnvError(`${name} must be a decimal ETH amount, got "${value}"`);
  }
}

/**
 * An exact wei integer, or undefined when the variable is absent.
 *
 * The distribution amounts are set as `DIST_*_WEI` in the deployment, and wei
 * is the form that cannot lose meaning: `0.000002` routed through a float and
 * back is not guaranteed to be the same integer the credit transaction sends.
 * The older `DIST_*_ETH` spelling is still honoured as a fallback so an
 * existing environment keeps working, but the wei value wins when both exist.
 */
function weiExact(name: string): bigint | undefined {
  const value = read(name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new EnvError(`${name} must be a whole number of wei, got "${value}"`);
  }
  return BigInt(value);
}

/* ------------------------------------------------------------------ secrets */

export function databaseUrl(): string {
  const url = required(
    "DATABASE_URL",
    "Put the Neon connection string in .env.local (postgresql://user:pass@host/db?sslmode=require).",
  );
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new EnvError("DATABASE_URL must be a postgresql:// connection string");
  }
  return url;
}

/** HMAC key for session cookies. */
export function authSecret(): string {
  const secret = required(
    "AUTH_SECRET",
    "Generate one with `openssl rand -hex 32`.",
  );
  // Short keys make cookie forgery cheap; there is no reason to allow them.
  if (secret.length < 32) {
    throw new EnvError("AUTH_SECRET must be at least 32 characters (use `openssl rand -hex 32`)");
  }
  return secret;
}

/**
 * The two accounts that write to SitowiseFactory on the operator's behalf.
 *
 * They are separate keys because they are separate powers and separate risks.
 * The relayer may only call `mintFor`, so a leak costs free nodes. The
 * distributor calls `creditBatch` payable, so it has to hold the ETH being
 * paid out and a leak costs that float. Neither can touch node balances: only
 * a node's own owner can withdraw.
 */
function privateKey(name: string, hint: string): `0x${string}` {
  const key = required(name, hint);
  const prefixed = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    throw new EnvError(`${name} must be 32 bytes of hex`);
  }
  return prefixed.toLowerCase() as `0x${string}`;
}

/** Signs `mintFor`. Must match `relayer()` on the contract or every mint reverts. */
export function relayerPrivateKey(): `0x${string}` {
  return privateKey("RELAYER_PRIVATE_KEY", "It is the account allowed to call mintFor.");
}

/** Signs `creditBatch`. Must match `distributor()` and must hold the payout float. */
export function distributorPrivateKey(): `0x${string}` {
  return privateKey("DISTRIBUTOR_PRIVATE_KEY", "It is the account allowed to call creditBatch.");
}

/**
 * Where node purchases land. Payment happens entirely outside the contract: the
 * buyer sends a plain transfer here, a watcher sees it, and the relayer mints
 * against that transaction hash. So this is an env value, not a contract read.
 */
export function paymentAddress(): `0x${string}` {
  const addr = required("PAYMENT_ADDRESS", "It is the wallet that receives node payments.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new EnvError("PAYMENT_ADDRESS must be a 20-byte hex address");
  }
  return addr.toLowerCase() as `0x${string}`;
}

/**
 * What one node costs, in wei.
 *
 * The contract has no `price()` any more, because it never sees the money. That
 * makes this the single figure the UI quotes and the watcher checks a payment
 * against, so it is read as an exact integer: a decimal ETH string routed
 * through a float would quote a price no transfer could ever match.
 */
export function nodePriceWei(): bigint {
  const raw = read("NODE_PRICE_WEI") ?? DEFAULT_NODE_PRICE_WEI;
  if (!/^\d+$/.test(raw)) {
    throw new EnvError(`NODE_PRICE_WEI must be a whole number of wei, got "${raw}"`);
  }
  const parsed = BigInt(raw);
  if (parsed <= 0n) throw new EnvError("NODE_PRICE_WEI must be greater than zero");
  return parsed;
}

export function adminKey(): string {
  return required("ADMIN_KEY", "Admin routes stay closed until it is set.");
}

/** Admin routes should behave as if they do not exist when no key is configured. */
export function hasAdminKey(): boolean {
  return read("ADMIN_KEY") !== undefined;
}

/* ------------------------------------------------------------------- public */

/**
 * Factory address, guaranteed deployed. Server code that mints or credits on
 * behalf of users must not silently work against the zero address.
 */
export function factoryAddress(): `0x${string}` {
  if (FACTORY_ADDRESS.toLowerCase() === ZERO_ADDRESS) {
    throw new EnvError("NEXT_PUBLIC_FACTORY is not set to a deployed SitowiseFactory address");
  }
  return FACTORY_ADDRESS;
}

/**
 * Chain id from env, cross-checked against the compiled-in constant. A mismatch
 * means the relayer would mint on one chain while the UI reads another.
 */
export function publicChainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID?.trim();
  if (!raw) return CHAIN_ID;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new EnvError(`NEXT_PUBLIC_CHAIN_ID must be a whole number, got "${raw}"`);
  }
  if (parsed !== CHAIN_ID) {
    throw new EnvError(`NEXT_PUBLIC_CHAIN_ID is ${parsed} but this build targets ${CHAIN_ID}`);
  }
  return parsed;
}

/* -------------------------------------------------------------- distribution */

export type DistMode = "treasury" | "swaps";

export type DistConfig = {
  enabled: boolean;
  mode: DistMode;
  minDelaySec: number;
  maxDelaySec: number;
  minAmountWei: bigint;
  maxAmountWei: bigint;
  /** Safety fuse: the worker stops for the day once it has credited this much. */
  dailyCapWei: bigint;
};

/**
 * How often a credit pass runs, in seconds.
 *
 * Not the same thing as the delay window: `DIST_MIN/MAX_DELAY_SEC` is how long
 * one node waits between its own credits, while this is how often the system
 * looks for nodes whose wait is over. It has to be no longer than the minimum
 * delay, or timers would routinely be overdue by the difference.
 *
 * Read separately from distConfig because it is not a distribution number that
 * /admin can override: the cadence belongs to whatever is calling the pass, a
 * cron schedule or the worker's own loop.
 */
export function distTickSec(): number {
  const value = int("DIST_TICK_SEC", 60);
  if (value < 1) throw new EnvError("DIST_TICK_SEC must be at least 1 second");
  return value;
}

/** Defaults are the spec section 8.3 numbers. Nothing here is hardcoded elsewhere. */
export const DIST_DEFAULTS = {
  enabled: true,
  mode: "treasury" as DistMode,
  minDelaySec: 60,
  maxDelaySec: 180,
  minAmountEth: "0.000002",
  maxAmountEth: "0.00001",
  // 50 nodes cost ~0.216 ETH/day at the default rates, so 1 ETH is a fuse, not
  // an operating limit. Raise it deliberately as the node count grows.
  dailyCapEth: "1",
} as const;

/**
 * Read and validate the distribution settings. Not memoised: the worker is a
 * long-lived process and a stale cache would be worse than the few
 * microseconds this costs per tick.
 */
export function distConfig(): DistConfig {
  const mode = (read("DIST_MODE") ?? DIST_DEFAULTS.mode).toLowerCase();
  if (mode !== "treasury" && mode !== "swaps") {
    throw new EnvError(`DIST_MODE must be treasury or swaps, got "${mode}"`);
  }

  const minDelaySec = int("DIST_MIN_DELAY_SEC", DIST_DEFAULTS.minDelaySec);
  const maxDelaySec = int("DIST_MAX_DELAY_SEC", DIST_DEFAULTS.maxDelaySec);
  if (minDelaySec < 1) throw new EnvError("DIST_MIN_DELAY_SEC must be at least 1");
  if (maxDelaySec < minDelaySec) {
    throw new EnvError("DIST_MAX_DELAY_SEC must be greater than or equal to DIST_MIN_DELAY_SEC");
  }

  const minAmountWei = weiExact("DIST_MIN_AMOUNT_WEI") ?? wei("DIST_MIN_AMOUNT_ETH", DIST_DEFAULTS.minAmountEth);
  const maxAmountWei = weiExact("DIST_MAX_AMOUNT_WEI") ?? wei("DIST_MAX_AMOUNT_ETH", DIST_DEFAULTS.maxAmountEth);
  if (minAmountWei <= 0n) throw new EnvError("DIST_MIN_AMOUNT_WEI must be greater than zero");
  if (maxAmountWei < minAmountWei) {
    throw new EnvError("DIST_MAX_AMOUNT_WEI must be greater than or equal to DIST_MIN_AMOUNT_WEI");
  }

  const dailyCapWei = weiExact("DIST_DAILY_CAP_WEI") ?? wei("DIST_DAILY_CAP_ETH", DIST_DEFAULTS.dailyCapEth);
  if (dailyCapWei <= 0n) throw new EnvError("DIST_DAILY_CAP_WEI must be greater than zero");

  return {
    enabled: bool("DIST_ENABLED", DIST_DEFAULTS.enabled),
    mode,
    minDelaySec,
    maxDelaySec,
    minAmountWei,
    maxAmountWei,
    dailyCapWei,
  };
}

/* -------------------------------------------------------------------- cron */

/**
 * Shared secret for /api/cron/*. Deliberately not ADMIN_KEY: a cron service
 * stores its key forever in someone else's configuration, so it gets one that
 * only starts a scheduled pass and can be rotated without locking the operator
 * out of /admin.
 */
export function cronKey(): string {
  const key = required("CRON_KEY", "Cron routes stay closed until it is set.");
  // The header is world-reachable and unrate-limited by the scheduler, so a
  // short key is a guessable key. 16 characters is the floor, 32 hex the norm.
  if (key.length < 16) {
    throw new EnvError("CRON_KEY must be at least 16 characters (use `openssl rand -hex 32`)");
  }
  return key;
}

/** Cron routes behave as if unconfigured rather than open when no key is set. */
export function hasCronKey(): boolean {
  return read("CRON_KEY") !== undefined;
}

/* ----------------------------------------------------------------- watcher */

/** A block number or a count of blocks. Whole numbers: blocks are not decimals. */
function blocks(name: string, fallback: bigint): bigint {
  const value = read(name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new EnvError(`${name} must be a whole number of blocks, got "${value}"`);
  }
  return BigInt(value);
}

export type WatcherConfig = {
  /** First block to read when there is no cursor yet, or null to use the window below. */
  startBlock: bigint | null;
  /** How far behind the head a first run starts when WATCHER_START_BLOCK is unset. */
  startWindowBlocks: bigint;
  /**
   * The most ground one pass may claim to have covered, however far behind the
   * cursor is. Discovery through the address index answers a range of any size
   * in one request, so this is not a cost ceiling — it is a trust ceiling: an
   * explorer that answers "nothing there" for a week-long hole should not be
   * able to erase a week of cursor in one unattended pass. A longer gap is
   * closed by more passes, or deliberately with the fast-forward tool.
   */
  maxCatchupBlocks: bigint;
  /**
   * Ceiling on the RPC block-read fallback, which only runs when the explorer
   * is down. Reading blocks manages ~5 a second against a chain that produces
   * ~9.8, so this is small on purpose: it exists to ride out a short outage,
   * not to catch up.
   */
  maxBlocksPerPass: bigint;
  /** Parallel RPC calls: verification lookups, and blocks in the fallback path. */
  batchSize: number;
  /** Blocks left unread behind the head, so a shallow reorg cannot strand a payment. */
  confirmations: bigint;
  /** Wall-clock budget for one scan, kept under the route's maxDuration. */
  budgetMs: number;
  /** Payments minted per pass. Each one is a transaction and a receipt wait. */
  mintBatch: number;
  /** A row stuck in `minting` this long is assumed to be a dead process. */
  stuckAfterSec: number;
  /** Transactions per explorer request. */
  explorerPageSize: number;
  /** Explorer requests one pass may make before it gives up and says so. */
  explorerMaxPages: number;
  /** Per-request timeout for the explorer, well inside the pass budget. */
  explorerTimeoutMs: number;
};

export const WATCHER_DEFAULTS = {
  // Roughly a few hours of Robinhood Chain at the time of writing: far enough
  // back to cover a deploy that happened moments ago, near enough that a first
  // run is not a multi-day backfill nobody asked for.
  startWindowBlocks: 5_000n,
  // About 17 minutes of chain. Several times any sane cron interval, so steady
  // state never touches it, and short of a long outage, which should be seen by
  // a human rather than swallowed.
  maxCatchupBlocks: 10_000n,
  // ~40 seconds of chain. The fallback is for an explorer blip during a quiet
  // minute; anything bigger waits for the explorer rather than pretending.
  maxBlocksPerPass: 200n,
  batchSize: 8,
  confirmations: 2n,
  budgetMs: 20_000,
  mintBatch: 5,
  stuckAfterSec: 300,
  explorerPageSize: 100,
  explorerMaxPages: 10,
  explorerTimeoutMs: 5_000,
} as const;

/**
 * Everything the payment watcher reads from the environment.
 *
 * `WATCHER_START_BLOCK` is the important one. Without a cursor the watcher has
 * to choose between scanning from genesis (hours of RPC for nothing) and
 * jumping to the head (silently skipping every payment made before it first
 * ran). Neither is acceptable unattended, so the operator names the block the
 * payments wallet started taking money at, and the default is a small window
 * behind the head that the scan result states out loud.
 */
export function watcherConfig(): WatcherConfig {
  const startRaw = read("WATCHER_START_BLOCK");
  if (startRaw !== undefined && !/^\d+$/.test(startRaw)) {
    throw new EnvError(`WATCHER_START_BLOCK must be a whole block number, got "${startRaw}"`);
  }

  const maxCatchupBlocks = blocks("WATCHER_MAX_CATCHUP_BLOCKS", WATCHER_DEFAULTS.maxCatchupBlocks);
  if (maxCatchupBlocks < 1n) throw new EnvError("WATCHER_MAX_CATCHUP_BLOCKS must be at least 1");

  // 0 is meaningful here: it switches the RPC fallback off entirely, for an
  // operator who would rather be told the explorer is down than have the
  // watcher spend a minute of RPC crawling behind it.
  const maxBlocksPerPass = blocks("WATCHER_MAX_BLOCKS_PER_PASS", WATCHER_DEFAULTS.maxBlocksPerPass);

  const explorerPageSize = int("WATCHER_EXPLORER_PAGE_SIZE", WATCHER_DEFAULTS.explorerPageSize);
  if (explorerPageSize < 10 || explorerPageSize > 1000) {
    throw new EnvError("WATCHER_EXPLORER_PAGE_SIZE must be between 10 and 1000");
  }

  const explorerMaxPages = int("WATCHER_EXPLORER_MAX_PAGES", WATCHER_DEFAULTS.explorerMaxPages);
  if (explorerMaxPages < 1 || explorerMaxPages > 100) {
    throw new EnvError("WATCHER_EXPLORER_MAX_PAGES must be between 1 and 100");
  }

  const explorerTimeoutMs = int("WATCHER_EXPLORER_TIMEOUT_MS", WATCHER_DEFAULTS.explorerTimeoutMs);
  if (explorerTimeoutMs < 1_000 || explorerTimeoutMs > 30_000) {
    throw new EnvError("WATCHER_EXPLORER_TIMEOUT_MS must be between 1000 and 30000");
  }

  const batchSize = int("WATCHER_BATCH_SIZE", WATCHER_DEFAULTS.batchSize);
  if (batchSize < 1 || batchSize > 25) {
    throw new EnvError("WATCHER_BATCH_SIZE must be between 1 and 25");
  }

  const budgetMs = int("WATCHER_BUDGET_MS", WATCHER_DEFAULTS.budgetMs);
  if (budgetMs < 1_000) throw new EnvError("WATCHER_BUDGET_MS must be at least 1000");

  const mintBatch = int("WATCHER_MINT_BATCH", WATCHER_DEFAULTS.mintBatch);
  if (mintBatch < 1 || mintBatch > 25) {
    throw new EnvError("WATCHER_MINT_BATCH must be between 1 and 25");
  }

  const stuckAfterSec = int("WATCHER_STUCK_AFTER_SEC", WATCHER_DEFAULTS.stuckAfterSec);
  if (stuckAfterSec < 30) throw new EnvError("WATCHER_STUCK_AFTER_SEC must be at least 30");

  return {
    startBlock: startRaw === undefined ? null : BigInt(startRaw),
    startWindowBlocks: blocks("WATCHER_START_WINDOW_BLOCKS", WATCHER_DEFAULTS.startWindowBlocks),
    maxCatchupBlocks,
    maxBlocksPerPass,
    batchSize,
    confirmations: blocks("WATCHER_CONFIRMATIONS", WATCHER_DEFAULTS.confirmations),
    budgetMs,
    mintBatch,
    stuckAfterSec,
    explorerPageSize,
    explorerMaxPages,
    explorerTimeoutMs,
  };
}

/* ------------------------------------------------------------------ preflight */

/**
 * Touch everything a full deployment needs, so a misconfigured environment
 * surfaces at once (admin health check, worker start) rather than one variable
 * at a time under user traffic. Returns the list of problems; empty means ready.
 */
export function checkEnv(): string[] {
  const problems: string[] = [];
  const checks: Array<() => unknown> = [
    databaseUrl,
    authSecret,
    relayerPrivateKey,
    distributorPrivateKey,
    paymentAddress,
    nodePriceWei,
    adminKey,
    // The watcher cannot be triggered without CRON_KEY, and a deployment whose
    // payments are never scanned takes money and hands out nothing.
    cronKey,
    factoryAddress,
    publicChainId,
    distConfig,
    watcherConfig,
  ];
  for (const check of checks) {
    try {
      check();
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  return problems;
}
