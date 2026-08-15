/**
 * The address index the RPC does not have, read from Blockscout.
 *
 * WHY THIS FILE EXISTS. Robinhood Chain produces about 9.8 blocks a second, and
 * a plain ETH transfer emits no log, so there is no `eth_getLogs` shape that can
 * find one: the only RPC-native way to spot a transfer to a wallet is to read
 * every block and look at every transaction's `to`. Measured against this
 * chain's public RPC that runs at about 5 blocks a second. A watcher built on it
 * loses ~4.8 blocks of ground every second it runs and never catches up — which
 * is exactly what happened: the cursor sat 57,637 blocks behind for a day.
 *
 * Blockscout already keeps the index the RPC lacks. One HTTP request answers
 * "every transaction involving this address between block A and block B", so
 * discovery costs one request per range instead of one per block, and the cost
 * stops scaling with how far behind the watcher is.
 *
 * WHAT THIS IS NOT. Authority. Everything returned here is a *hint*: an
 * explorer is a third-party database that can lag, backfill out of order, be
 * rolled back, or simply be wrong. Nothing in this file is allowed to cause a
 * payment to be recorded. lib/watcher.ts re-reads every candidate from the chain
 * before it writes a row, and the chain wins every disagreement.
 *
 * Two endpoints, and which one leads was decided by measuring this instance
 * rather than by which has the nicer shape:
 *   - `/addresses/{a}/transactions?filter=to` (v2) has no range filter and pages
 *     backwards from the tip, but it answered 12 of 12 rapid requests. Since the
 *     wallet it watches takes one transfer per sale and the walk stops at the
 *     first transaction below the cursor, the missing range filter costs nothing
 *     in practice: the answer is normally one request. This is the normal path.
 *   - `txlist` (v1) takes `startblock`/`endblock`, so any range is one query —
 *     but it is rate limited hard (429 on the fourth rapid request), which makes
 *     it a bad thing to depend on every minute. It is the second opinion when v2
 *     errors, and the range query the fast-forward check uses once by hand.
 *
 * Both return the occasional 500, so every request is retried a couple of times
 * before it is called a failure; a blip must not make the watcher declare itself
 * blind, and a real outage still must.
 */

import {EXPLORER_URL} from "@/lib/chain";

const V1 = `${EXPLORER_URL}/api`;
const V2 = `${EXPLORER_URL}/api/v2`;

/**
 * Anything that stopped the index from answering. Its own class because the
 * caller has to tell "the explorer is down" (degrade loudly, hold the cursor)
 * apart from "the explorer answered, there is nothing there" (carry on).
 */
export class ExplorerError extends Error {
  /** False for "you asked wrong": retrying a 400 just spends the budget twice. */
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "ExplorerError";
    this.retryable = retryable;
  }
}

/** One transaction as the index describes it. Every field is still a claim. */
export type IndexedTransfer = {
  hash: `0x${string}`;
  from: `0x${string}`;
  /** null for a contract creation, which is never a payment. */
  to: `0x${string}` | null;
  valueWei: bigint;
  blockNumber: bigint;
  /** The index's view of the receipt. Re-read from the chain before it is used. */
  succeeded: boolean;
};

export type IndexWalk = {
  /** Transactions addressed to the wallet, ascending by block. */
  transfers: IndexedTransfer[];
  source: "txlist" | "addresses-v2";
  requests: number;
  /**
   * The highest block this walk can honestly claim to have looked at every
   * transaction in. Below `from` means "claim nothing": the walk stopped before
   * it reached the bottom of the range, so the caller must not move its cursor.
   */
  coveredTo: bigint;
  /** False when a page limit cut the walk short of the whole range. */
  complete: boolean;
};

export type WalkOptions = {
  /** Transactions per request. Blockscout caps this well above anything we ask for. */
  pageSize?: number;
  /** Hard ceiling on requests, so one pass cannot page forever. */
  maxPages?: number;
  /** Per-request timeout. The pass has its own overall deadline on top. */
  timeoutMs?: number;
  /** Wall-clock stop for the whole walk, from the caller's own budget. */
  deadline?: number;
};

const DEFAULTS = {pageSize: 100, maxPages: 10, timeoutMs: 5_000} as const;

/* ------------------------------------------------------------------ fetch */

/** Attempts per URL, including the first. Two retries is enough for a blip. */
const ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function once(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // `no-store` because a cached "no transactions" is a lost sale, and Next's
    // fetch cache is shared across invocations of the same route.
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {accept: "application/json"},
    });
    if (!res.ok) {
      throw new ExplorerError(
        `explorer returned HTTP ${res.status}`,
        res.status >= 500 || res.status === 429,
      );
    }
    return await res.json();
  } catch (err) {
    if (err instanceof ExplorerError) throw err;
    // Deliberately not the underlying message: it is third-party text that ends
    // up in operator logs and, through the health endpoint, in public JSON. The
    // shape of the failure is all anybody needs to act on.
    throw new ExplorerError(
      controller.signal.aborted ? `explorer timed out after ${timeoutMs}ms` : "explorer unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One request, retried on the failures that are worth retrying.
 *
 * This instance returns intermittent 500s and rate limits the v1 API, and both
 * clear on a second attempt. Without this the watcher would declare itself blind
 * — and raise an alert — several times an hour over nothing. `deadline` keeps
 * the retries inside the caller's own budget rather than spending it for them.
 */
async function getJson(url: string, timeoutMs: number, deadline?: number): Promise<unknown> {
  let last: ExplorerError = new ExplorerError("explorer unreachable");
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const backoff = 250 * attempt * attempt;
      if (deadline !== undefined && Date.now() + backoff + timeoutMs > deadline) break;
      await sleep(backoff);
    }
    try {
      return await once(url, timeoutMs);
    } catch (err) {
      last = err instanceof ExplorerError ? err : new ExplorerError("explorer unreachable");
      if (!last.retryable) throw last;
    }
  }
  throw last;
}

/* ----------------------------------------------------------------- parsing */

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hashOf(value: unknown): `0x${string}` | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : null;
}

function addressOf(value: unknown): `0x${string}` | null {
  // v2 nests the address in an object with a `hash`; v1 gives a bare string.
  const raw = typeof value === "string" ? value : record(value)?.hash;
  return typeof raw === "string" && /^0x[0-9a-fA-F]{40}$/.test(raw)
    ? (raw.toLowerCase() as `0x${string}`)
    : null;
}

function wholeNumber(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

/**
 * A malformed entry is skipped rather than thrown on. One unparseable row in a
 * page of fifty must not blind the watcher to the other forty-nine; the entry
 * that was skipped stays undiscovered, and the cursor logic below is what keeps
 * that from turning into a silently lost payment.
 */
function parseV1(item: unknown): IndexedTransfer | null {
  const row = record(item);
  if (!row) return null;
  const hash = hashOf(row.hash);
  const from = addressOf(row.from);
  const blockNumber = wholeNumber(row.blockNumber);
  const valueWei = wholeNumber(row.value);
  if (!hash || !from || blockNumber === null || valueWei === null) return null;
  return {
    hash,
    from,
    to: addressOf(row.to),
    valueWei,
    blockNumber,
    // v1 reports both; `isError` is the older field and the more widely filled in.
    succeeded: row.isError !== "1" && row.txreceipt_status !== "0",
  };
}

function parseV2(item: unknown): IndexedTransfer | null {
  const row = record(item);
  if (!row) return null;
  const hash = hashOf(row.hash);
  const from = addressOf(row.from);
  const blockNumber = wholeNumber(row.block_number);
  const valueWei = wholeNumber(row.value);
  if (!hash || !from || blockNumber === null || valueWei === null) return null;
  return {
    hash,
    from,
    to: addressOf(row.to),
    valueWei,
    blockNumber,
    succeeded: row.result === "success" || row.status === "ok",
  };
}

/* -------------------------------------------------------------- v1 txlist */

function txlistUrl(
  address: `0x${string}`,
  from: bigint,
  to: bigint,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams({
    module: "account",
    action: "txlist",
    address,
    startblock: from.toString(),
    endblock: to.toString(),
    // Ascending, so a page limit leaves a contiguous covered prefix of the range
    // rather than a hole in the middle of it.
    sort: "asc",
    page: String(page),
    offset: String(pageSize),
  });
  return `${V1}?${params.toString()}`;
}

/**
 * Every transaction the index holds for `address` between two blocks, filtered
 * down to the ones addressed TO it.
 *
 * The empty answer needs care: Blockscout reports "nothing here" as
 * `status: "0"` with `message: "No transactions found"`, which is the same
 * status field it uses for real errors. Treating that as an error would make an
 * idle wallet look like an outage; treating a real error as empty would make an
 * outage look like an idle wallet. Both are checked explicitly.
 */
export async function walkTxlist(
  address: `0x${string}`,
  from: bigint,
  to: bigint,
  opts: WalkOptions = {},
): Promise<IndexWalk> {
  const pageSize = opts.pageSize ?? DEFAULTS.pageSize;
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;

  const transfers: IndexedTransfer[] = [];
  let requests = 0;
  let highestSeen: bigint | null = null;

  for (let page = 1; page <= maxPages; page++) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) {
      // Out of time mid-range. Everything below the last block we read is known,
      // and that block itself may be half-read, so it does not count.
      return {
        transfers,
        source: "txlist",
        requests,
        coveredTo: highestSeen === null ? from - 1n : highestSeen - 1n,
        complete: false,
      };
    }

    const body = record(
      await getJson(txlistUrl(address, from, to, page, pageSize), timeoutMs, opts.deadline),
    );
    requests++;
    if (!body) throw new ExplorerError("explorer returned a non-object body");

    const items = Array.isArray(body.result) ? body.result : null;
    if (items === null) {
      const message = typeof body.message === "string" ? body.message : "";
      if (body.status === "0" && /no transactions found/i.test(message)) {
        return {transfers, source: "txlist", requests, coveredTo: to, complete: true};
      }
      // A 200 carrying "Max rate limit reached" is v1's way of saying 429.
      throw new ExplorerError(
        `explorer rejected the query${message ? `: ${message}` : ""}`,
        /rate limit/i.test(message),
      );
    }

    for (const item of items) {
      const parsed = parseV1(item);
      if (!parsed) continue;
      if (parsed.blockNumber > (highestSeen ?? 0n)) highestSeen = parsed.blockNumber;
      if (parsed.to === address) transfers.push(parsed);
    }

    // A short page is the last page. Blockscout has no "has more" flag on v1.
    if (items.length < pageSize) {
      return {transfers, source: "txlist", requests, coveredTo: to, complete: true};
    }
  }

  return {
    transfers,
    source: "txlist",
    requests,
    // The page ceiling stopped us part way. The last block read may have more
    // transactions on a page we never asked for, so coverage stops below it.
    coveredTo: highestSeen === null ? from - 1n : highestSeen - 1n,
    complete: false,
  };
}

/* ------------------------------------------------- v2 addresses/{a}/txs */

function v2Url(address: `0x${string}`, pageParams: Record<string, string> | null): string {
  const params = new URLSearchParams({filter: "to", ...(pageParams ?? {})});
  return `${V2}/addresses/${address}/transactions?${params.toString()}`;
}

/** `next_page_params` verbatim, flattened to strings; nulls dropped. */
function nextParams(value: unknown): Record<string, string> | null {
  const row = record(value);
  if (!row) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(row)) {
    if (item === null || item === undefined) continue;
    if (typeof item === "object") continue;
    out[key] = String(item);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The same question asked of the v2 API, which only pages backwards from the
 * tip. Used when `txlist` errors: it is a separate route through Blockscout, so
 * a fault in one is not usually a fault in both.
 *
 * It pages until it drops below `from`, which is why it is the fallback and not
 * the default — a wallet with a long history costs a request per fifty
 * transactions before it reaches the range anybody asked about.
 */
export async function walkAddressV2(
  address: `0x${string}`,
  from: bigint,
  to: bigint,
  opts: WalkOptions = {},
): Promise<IndexWalk> {
  const maxPages = opts.maxPages ?? DEFAULTS.maxPages;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;

  const transfers: IndexedTransfer[] = [];
  let requests = 0;
  let params: Record<string, string> | null = null;

  for (let page = 0; page < maxPages; page++) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;

    const body = record(await getJson(v2Url(address, params), timeoutMs, opts.deadline));
    requests++;
    if (!body || !Array.isArray(body.items)) {
      throw new ExplorerError("explorer returned an unexpected body");
    }

    let reachedBottom = false;
    for (const item of body.items) {
      const parsed = parseV2(item);
      if (!parsed) continue;
      if (parsed.blockNumber < from) {
        // Newest-first, so the first transaction below the range means every
        // remaining one is older still: the range is fully walked.
        reachedBottom = true;
        break;
      }
      if (parsed.blockNumber <= to && parsed.to === address) transfers.push(parsed);
    }

    params = nextParams(body.next_page_params);
    if (reachedBottom || params === null) {
      transfers.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
      return {transfers, source: "addresses-v2", requests, coveredTo: to, complete: true};
    }
  }

  // Stopped above the bottom of the range. The blocks nearest the head were
  // walked, but the ones just above the cursor were not, and coverage has to be
  // contiguous from the cursor to be worth anything — so claim none of it.
  transfers.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
  return {transfers, source: "addresses-v2", requests, coveredTo: from - 1n, complete: false};
}

/* ------------------------------------------------------------- index head */

/**
 * The highest block Blockscout has indexed.
 *
 * The watcher needs this to avoid the quiet failure mode of an index-based
 * scanner: an explorer that is behind the chain answers "no transactions" for a
 * range it simply has not read yet. Coverage is never claimed past this number.
 */
export async function indexedHead(
  timeoutMs: number = DEFAULTS.timeoutMs,
  deadline?: number,
): Promise<bigint> {
  // Two sources because either returns the occasional 500, and being unable to
  // read this number costs the watcher a whole pass of cursor movement.
  const sources = [`${V2}/blocks?type=block`, `${V2}/main-page/blocks`];
  let last: unknown = new ExplorerError("explorer did not report an indexed block height");

  for (const url of sources) {
    try {
      const body = await getJson(url, timeoutMs, deadline);
      // /blocks wraps the list in `items`; /main-page/blocks is a bare array.
      const items = Array.isArray(body) ? body : record(body)?.items;
      const height =
        Array.isArray(items) && items.length > 0 ? wholeNumber(record(items[0])?.height) : null;
      if (height !== null) return height;
      last = new ExplorerError("explorer did not report an indexed block height");
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
