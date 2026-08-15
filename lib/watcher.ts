/**
 * The payment watcher: the half of the sale that happens before any contract
 * call.
 *
 * A buyer does not mint. A buyer sends a plain ETH transfer to PAYMENT_ADDRESS,
 * and this module is the only thing that ever notices. It finds those transfers,
 * checks each one against the chain, and writes it down. Minting is somebody
 * else's job (lib/mintRelay.ts), and it only ever works from rows this module
 * has already committed.
 *
 * Four rules hold the money side up:
 *
 *   1. Record before mint. A payment is in the database at `seen` before the
 *      relayer is asked for anything. A crash then costs a delay, never a sale.
 *
 *   2. Exact amount or nothing. Only a transfer of exactly `nodePriceWei()`
 *      becomes `seen`. Under, over and zero all become `manual_review` with the
 *      amount in the note. A node is never handed out for a wrong payment,
 *      because deciding what a wrong payment deserves is a human's job.
 *
 *   3. The explorer discovers; the chain decides. Every candidate is re-read
 *      with eth_getTransactionByHash and its receipt before a row is written:
 *      it must exist, have succeeded, actually be addressed to the payments
 *      wallet, and carry the value and sender the index claimed. Nothing is
 *      ever recorded from explorer data alone.
 *
 *   4. The cursor moves only over ground that was genuinely covered. Payments
 *      and the cursor advance in one transaction, so a crash can repeat a range
 *      (harmless: `tx_hash` is unique) but can never step over one.
 *
 * WHY DISCOVERY MOVED OFF THE RPC. This used to read every block with
 * eth_getBlockByNumber and filter transactions by `to`, because a plain transfer
 * emits no log and there is no eth_getLogs shape that can find one. Measured,
 * that manages about 5 blocks a second against a chain that produces about 9.8:
 * a negative catch-up rate, so the watcher fell further behind every second it
 * ran, and no budget or batch size can fix a negative rate. In production it sat
 * 57,637 blocks behind for a day and every scheduled run died on its time
 * budget. Discovery now goes through Blockscout's address index
 * (lib/explorer.ts), which answers for a whole range in a request or two
 * whatever its size, so the cost of a pass stops scaling with the size of the
 * gap. The block reader survives only as a
 * narrow fallback over a small range while the explorer is unreachable.
 *
 * WHEN DISCOVERY IS BLIND, IT SAYS SO. A watcher that quietly sees nothing is
 * worse than one that says it cannot see: the pass reports `degraded`, a stop
 * reason naming what failed, and it raises the `payment_discovery` alert that
 * /admin and /api/cron/health both read. It holds its cursor rather than
 * claiming ground it never covered.
 */

import {clearAlert, raiseAlert} from "@/lib/alerts";
import {sql, tx} from "@/lib/db";
import {nodePriceWei, paymentAddress, watcherConfig, type WatcherConfig} from "@/lib/env";
import {
  ExplorerError,
  indexedHead,
  walkAddressV2,
  walkTxlist,
  type IndexedTransfer,
} from "@/lib/explorer";
import {getCursor, recordSeen, setCursor} from "@/lib/payments";
import {receiptFor, rpc, transactionFor} from "@/lib/rpc";

/** Key in `watcher_state`. One watcher, one cursor; named so the table can hold others. */
export const PAYMENTS_CURSOR = "payments";

/**
 * Measured block rate of Robinhood Chain. Used only to turn a block gap into the
 * number an operator actually thinks in ("twenty minutes behind"), never to
 * decide anything.
 */
export const BLOCKS_PER_SECOND = 9.8;

/**
 * How far the explorer's index may trail the chain head before that counts as a
 * fault rather than as normal operation. Measured against production it runs
 * about 200 blocks (~20 seconds) behind, which is simply how long indexing
 * takes; the watcher therefore sits a few hundred blocks behind the head in
 * healthy steady state and must not page anybody about it. Minutes of lag is a
 * different matter, and is what this threshold is set to catch.
 */
export const INDEX_LAG_TOLERANCE = 2_000n;

/** Why a pass stopped where it did. Only `caught-up` and `no-work` mean "all clear". */
export type WatcherStop =
  | "no-work"
  | "caught-up"
  /** Covered the range, but refused to claim more cursor than one pass may. */
  | "catchup-ceiling"
  | "time-budget"
  /** Hit the explorer request ceiling before reaching the bottom of the range. */
  | "page-limit"
  /** The explorer could not be read. Discovery is blind; the cursor did not move. */
  | "explorer-error"
  /** The explorer answered but has not indexed as far as the chain head. */
  | "explorer-behind"
  /** A discovered transaction the RPC does not know yet. Coverage stops below it. */
  | "unverified"
  | "rpc-error";

/** Where this pass's candidates came from. */
export type DiscoverySource = "txlist" | "addresses-v2" | "rpc-fallback" | "none";

/** One transfer the watcher decided about, before it was written. */
export type PaymentSighting = {
  txHash: `0x${string}`;
  from: `0x${string}`;
  amountWei: bigint;
  blockNumber: bigint;
  status: "seen" | "manual_review";
  note?: string;
};

export type WatcherScan = {
  headBlock: string;
  /** Head minus `confirmations`; nothing above this is acted on. */
  safeHead: string;
  /** Highest block Blockscout has indexed, or null when it could not be read. */
  indexedHead: string | null;
  /** null when the pass claimed no ground. */
  fromBlock: string | null;
  toBlock: string | null;
  /** Blocks of ground this pass claimed, i.e. how far the cursor moved. */
  blocksScanned: number;
  /** Transactions the index offered for this range. */
  candidates: number;
  /** Of those, how many the chain confirmed as transfers to the payments wallet. */
  transfersFound: number;
  /** Candidates the chain refused: reverted, or not addressed to us after all. */
  rejected: number;
  /** Candidates the RPC has not caught up to yet. They hold the cursor back. */
  unverified: number;
  /** Rows this pass inserted. Excludes transfers already recorded by an earlier pass. */
  recorded: number;
  duplicates: number;
  /** Of `recorded`, how many were parked for a human because something was off. */
  manualReview: number;
  /** Blocks between the cursor and the safe head. Zero means fully caught up. */
  behindBlocks: string;
  caughtUp: boolean;
  /** True when this pass had to invent a starting point because no cursor existed. */
  firstRun: boolean;
  /** Plain sentence about anything the numbers alone do not explain. */
  note: string | null;
  stopped: WatcherStop;
  discovery: DiscoverySource;
  /** HTTP requests to the explorer. */
  explorerRequests: number;
  /** eth_getBlockByNumber calls. Zero unless the fallback ran. */
  blockRequests: number;
  /**
   * True when payment discovery is not working properly, whatever else the
   * numbers say. /api/cron/health and /admin read this.
   */
  degraded: boolean;
  /** One sentence, safe to show: never an upstream body and never a stack. */
  degradedReason: string | null;
  durationMs: number;
};

/* --------------------------------------------------------------- deciding */

/**
 * Which status a transfer to the payments wallet earns.
 *
 * Everything that is not exactly the price is parked. The note carries the
 * amount, because "wrong amount" without the number is useless to whoever has
 * to decide between refunding and topping up.
 */
export function classify(
  amountWei: bigint,
  priceWei: bigint,
  from: `0x${string}`,
  payTo: `0x${string}`,
): {status: "seen" | "manual_review"; note?: string} {
  // The operator moving float out of and back into the payments wallet must not
  // mint the operator a node, and it is the one case where an exact amount is
  // still not a sale.
  if (from === payTo) {
    return {status: "manual_review", note: "self-transfer from the payments wallet, not a purchase"};
  }
  if (amountWei === priceWei) return {status: "seen"};
  if (amountWei === 0n) {
    return {status: "manual_review", note: "zero-value transaction to the payments wallet"};
  }
  const verb = amountWei < priceWei ? "under" : "over";
  return {
    status: "manual_review",
    note: `${verb}paid: ${amountWei.toString()} wei against a price of ${priceWei.toString()} wei`,
  };
}

/* -------------------------------------------------------------- verifying */

/**
 * What the chain said about one candidate.
 *
 * `unverified` is not `rejected`. A transaction the RPC has not caught up to may
 * be a real payment a second from now, so it holds the cursor below its block
 * instead of being discarded; a reverted transaction, or one addressed
 * elsewhere, is a settled fact the cursor may move straight past.
 */
type Verdict =
  | {kind: "payment"; sighting: PaymentSighting; mismatch: boolean}
  | {kind: "unverified"; blockNumber: bigint; reason: string}
  | {kind: "rejected"; reason: string};

/**
 * Re-read one candidate from the chain and decide what it really is.
 *
 * The index is a third-party database. It can be stale, it can be mid-backfill,
 * and in principle it can be wrong; acting on it directly would mean minting a
 * node against a transaction nobody has proved happened. So every field that
 * matters is taken from `eth_getTransactionByHash` and its receipt, and the
 * index's own version of events is used for exactly one thing: noticing a
 * disagreement.
 */
async function verify(
  candidate: IndexedTransfer,
  priceWei: bigint,
  payTo: `0x${string}`,
  safeHead: bigint,
): Promise<Verdict> {
  const [transaction, receipt] = await Promise.all([
    transactionFor(candidate.hash),
    receiptFor(candidate.hash),
  ]);

  // Either the RPC has not seen it yet or it never landed. Both mean "ask again
  // next pass", and neither may be recorded.
  if (!transaction) {
    return {
      kind: "unverified",
      blockNumber: candidate.blockNumber,
      reason: "the RPC does not know this transaction",
    };
  }
  if (transaction.blockNumber === null || !receipt) {
    return {
      kind: "unverified",
      blockNumber: candidate.blockNumber,
      reason: "still pending on chain",
    };
  }

  // A reverted transaction moved no money, whatever the index shows for it.
  if (receipt.status !== "success") return {kind: "rejected", reason: "reverted on chain"};

  // The index was asked for transactions addressed to the payments wallet. If
  // the chain disagrees, the index answered the wrong question and this is not
  // our money.
  const to = transaction.to?.toLowerCase() ?? null;
  if (to !== payTo) return {kind: "rejected", reason: "not addressed to the payments wallet"};

  const blockNumber = transaction.blockNumber;
  // Nothing from the very tip. A transfer read out of a block that then reorgs
  // away would be recorded as a paid sale that no longer exists, and the relayer
  // would mint a free node against it.
  if (blockNumber > safeHead) {
    return {kind: "unverified", blockNumber, reason: "not yet confirmed"};
  }
  if (receipt.blockNumber !== blockNumber) {
    // Transaction and receipt came from two different views of the chain. Rare,
    // and never worth guessing about.
    return {
      kind: "unverified",
      blockNumber,
      reason: "transaction and receipt disagree on the block",
    };
  }

  const from = transaction.from.toLowerCase() as `0x${string}`;
  const verdict = classify(transaction.value, priceWei, from, payTo);
  const mismatch = transaction.value !== candidate.valueWei || from !== candidate.from;

  return {
    kind: "payment",
    mismatch,
    sighting: {
      txHash: candidate.hash,
      from,
      // Chain values, always. The index's numbers never reach the database.
      amountWei: transaction.value,
      blockNumber,
      // An index that misreports a payment is a reason for a human to look, even
      // when the chain's own amount happens to be exactly right.
      status: mismatch ? "manual_review" : verdict.status,
      note: mismatch
        ? `explorer index disagreed with the chain (index said ${candidate.valueWei.toString()} wei ` +
          `from ${candidate.from}); recorded from the chain`
        : verdict.note,
    },
  };
}

/** Run `work` over `items` a few at a time: latency-bound, but not a fan-out storm. */
async function inBatches<T, R>(
  items: T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(work))));
  }
  return out;
}

/* ---------------------------------------------------------------- writing */

/**
 * Commit one pass: every payment found, then the cursor, in one transaction.
 *
 * The cursor is written last inside the transaction and both land or neither
 * does. If this throws, nothing moved and the next pass covers the same range
 * again — which is free of consequence, since `payments.tx_hash` is unique and
 * `recordSeen` is a no-op for a hash already held.
 *
 * `cursorTo` is null when the pass has no ground to claim (the explorer was
 * unreadable, or a candidate could not be verified). Payments found are still
 * written: holding the cursor is about coverage, and a payment proved against
 * the chain is proved whether or not the cursor moves.
 */
async function commit(
  sightings: PaymentSighting[],
  cursorTo: bigint | null,
): Promise<{recorded: number; duplicates: number; manualReview: number}> {
  if (sightings.length === 0) {
    // The overwhelmingly common case. Opening a pooled transaction to write one
    // row number would double the cost of an idle pass.
    if (cursorTo !== null) await setCursor(cursorTo, PAYMENTS_CURSOR);
    return {recorded: 0, duplicates: 0, manualReview: 0};
  }

  return tx(async (q) => {
    let recorded = 0;
    let duplicates = 0;
    let manualReview = 0;

    for (const sighting of sightings) {
      const {inserted} = await recordSeen(
        {
          txHash: sighting.txHash,
          from: sighting.from,
          amountWei: sighting.amountWei,
          blockNumber: sighting.blockNumber,
          status: sighting.status,
          note: sighting.note,
        },
        q,
      );
      if (!inserted) {
        duplicates++;
        continue;
      }
      recorded++;
      if (sighting.status === "manual_review") manualReview++;
    }

    if (cursorTo !== null) await setCursor(cursorTo, PAYMENTS_CURSOR, q);
    return {recorded, duplicates, manualReview};
  });
}

/* -------------------------------------------------------------- discovery */

type Discovery = {
  source: DiscoverySource;
  candidates: IndexedTransfer[];
  /** Highest block whose transactions are fully known. Below `from` claims nothing. */
  coveredTo: bigint;
  explorerRequests: number;
  blockRequests: number;
  indexedHead: bigint | null;
  /** Set when discovery itself is the reason the pass stops here. */
  stop: WatcherStop | null;
  /** One safe sentence when discovery did not work properly. */
  problem: string | null;
};

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0];
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * The old block reader, kept on a short leash.
 *
 * It is the only way to see a transfer without the explorer, and it is slower
 * than the chain it reads, so it may run only over a range small enough to
 * finish: a blip during a quiet minute, never a catch-up mechanism.
 * `WATCHER_MAX_BLOCKS_PER_PASS=0` switches it off entirely, for an operator who
 * would rather wait for the explorer than spend a minute of RPC crawling.
 */
async function fallbackBlockScan(
  payTo: `0x${string}`,
  from: bigint,
  to: bigint,
  cfg: WatcherConfig,
  deadline: number,
): Promise<{
  candidates: IndexedTransfer[];
  coveredTo: bigint;
  requests: number;
  error: string | null;
}> {
  const client = rpc();
  const candidates: IndexedTransfer[] = [];
  let requests = 0;
  let covered = from - 1n;

  let next = from;
  while (next <= to) {
    if (Date.now() >= deadline) break;

    const batch: bigint[] = [];
    for (let b = next; b <= to && batch.length < cfg.batchSize; b++) batch.push(b);

    let blocks;
    try {
      // Parallel because this is latency-bound: eight in flight turns an 800ms
      // round trip per block into 800ms per eight. Bounded because an unbounded
      // fan-out at a public RPC gets rate limited, and a rate-limited watcher is
      // a stopped watcher.
      blocks = await Promise.all(
        batch.map((blockNumber) => client.getBlock({blockNumber, includeTransactions: true})),
      );
      requests += batch.length;
    } catch (err) {
      // Stop rather than skip the batch: skipping is the one thing that loses a
      // payment silently. Everything already covered stands.
      return {candidates, coveredTo: covered, requests, error: firstLine(err)};
    }

    for (const block of blocks) {
      for (const transaction of block.transactions) {
        // A transfer to a plain wallet emits no log, so `to` on the transaction
        // is the only evidence there is.
        if (transaction.to?.toLowerCase() !== payTo) continue;
        candidates.push({
          hash: transaction.hash.toLowerCase() as `0x${string}`,
          from: transaction.from.toLowerCase() as `0x${string}`,
          to: payTo,
          valueWei: transaction.value,
          blockNumber: block.number ?? batch[0],
          succeeded: true,
        });
      }
    }

    covered = batch[batch.length - 1];
    next = covered + 1n;
  }

  return {candidates, coveredTo: covered, requests, error: null};
}

/**
 * Find every transaction addressed to the payments wallet in [from, safeHead].
 *
 * Order of preference: the ranged index query, then the paged one, then the
 * block reader. Each step down costs more and can honestly cover less ground,
 * and the two below the first only happen when the one above them errored.
 */
async function discover(
  payTo: `0x${string}`,
  from: bigint,
  safeHead: bigint,
  cfg: WatcherConfig,
  deadline: number,
): Promise<Discovery> {
  const walkOpts = {
    pageSize: cfg.explorerPageSize,
    maxPages: cfg.explorerMaxPages,
    timeoutMs: cfg.explorerTimeoutMs,
    deadline,
  };

  // The quiet failure mode of any index-based scanner: an explorer that is
  // behind the chain answers "no transactions" for a range it has not read yet,
  // which is indistinguishable from an empty range. Coverage is never claimed
  // past the height the explorer itself admits to.
  let head: bigint | null = null;
  let headProblem: string | null = null;
  try {
    head = await indexedHead(cfg.explorerTimeoutMs, deadline);
  } catch (err) {
    headProblem =
      err instanceof ExplorerError
        ? `could not read the explorer's indexed height (${err.message})`
        : "could not read the explorer's indexed height";
  }

  const to = head === null ? safeHead : min(safeHead, head);
  let explorerRequests = 1;

  if (head !== null && to < from) {
    // The explorer has not reached our range at all. Nothing to discover, and
    // nothing may be claimed.
    return {
      source: "none",
      candidates: [],
      coveredTo: from - 1n,
      explorerRequests,
      blockRequests: 0,
      indexedHead: head,
      stop: "explorer-behind",
      // Not phrased as a fault: in steady state the cursor catches up to the
      // index and then waits a few seconds for it to move. scanPayments decides
      // whether this lag is normal or worth an alert.
      problem: `waiting for the explorer to index past block ${head.toString()}`,
    };
  }

  let problem = headProblem;

  try {
    const walk = await walkAddressV2(payTo, from, to, walkOpts);
    explorerRequests += walk.requests;
    return {
      source: "addresses-v2",
      candidates: walk.transfers,
      // Without the explorer's own height there is no evidence it has read this
      // range, so its answer is used for what it found and not for what it did
      // not: payments are recorded, the cursor stays where it is.
      coveredTo: head === null ? from - 1n : walk.coveredTo,
      explorerRequests,
      blockRequests: 0,
      indexedHead: head,
      stop: head === null ? "explorer-error" : walk.complete ? null : "page-limit",
      problem,
    };
  } catch (err) {
    problem = [problem, err instanceof ExplorerError ? err.message : "explorer query failed"]
      .filter(Boolean)
      .join("; ");
  }

  // Second opinion: the ranged v1 query, which is a different code path through
  // Blockscout. It is rate limited too hard to lead with, but as a fallback that
  // only runs when v2 failed, its quota is exactly what is wanted.
  try {
    const walk = await walkTxlist(payTo, from, to, walkOpts);
    explorerRequests += walk.requests;
    return {
      source: "txlist",
      candidates: walk.transfers,
      coveredTo: head === null ? from - 1n : walk.coveredTo,
      explorerRequests,
      blockRequests: 0,
      indexedHead: head,
      stop: head === null ? "explorer-error" : walk.complete ? null : "page-limit",
      problem: `${problem}; answered by the ranged index instead`,
    };
  } catch (err) {
    problem = `${problem}; ${err instanceof ExplorerError ? err.message : "explorer query failed"}`;
  }

  // Both index routes are down. Read blocks, but only if the gap is small
  // enough that reading them can actually finish.
  const span = to >= from ? to - from + 1n : 0n;
  if (cfg.maxBlocksPerPass > 0n && span > 0n && span <= cfg.maxBlocksPerPass) {
    const scan = await fallbackBlockScan(payTo, from, to, cfg, deadline);
    return {
      source: "rpc-fallback",
      candidates: scan.candidates,
      coveredTo: scan.coveredTo,
      explorerRequests,
      blockRequests: scan.requests,
      indexedHead: head,
      stop: scan.error === null ? null : "rpc-error",
      problem: `${problem}; read ${scan.requests} block(s) directly instead`,
    };
  }

  return {
    source: "none",
    candidates: [],
    coveredTo: from - 1n,
    explorerRequests,
    blockRequests: 0,
    indexedHead: head,
    stop: "explorer-error",
    problem:
      span > cfg.maxBlocksPerPass
        ? `${problem}; the gap of ${span.toString()} blocks is too wide to read block by block`
        : problem,
  };
}

/* ------------------------------------------------------------------- pass */

/** Where a pass with no cursor begins, and the sentence explaining that choice. */
function startingPoint(cfg: WatcherConfig, safeHead: bigint): {from: bigint; note: string} {
  if (cfg.startBlock !== null) {
    return {
      from: cfg.startBlock,
      note: `first run: starting at WATCHER_START_BLOCK ${cfg.startBlock.toString()}`,
    };
  }
  const from = safeHead > cfg.startWindowBlocks ? safeHead - cfg.startWindowBlocks : 0n;
  return {
    from,
    // Said out loud because it is the one moment the watcher can lose a real
    // payment: anything paid before this block will never be seen unless a
    // human sets WATCHER_START_BLOCK and clears the cursor.
    note:
      `first run: no cursor, starting ${cfg.startWindowBlocks.toString()} blocks behind the head ` +
      `at ${from.toString()}. Transfers older than that block were NOT scanned; ` +
      `set WATCHER_START_BLOCK to the block the payments wallet opened if any are missing.`,
  };
}

export type ScanOptions = {
  /** Overrides WATCHER_BUDGET_MS. The cron route shortens it to leave time for minting. */
  budgetMs?: number;
  /** Overrides WATCHER_MAX_CATCHUP_BLOCKS: the most cursor one pass may claim. */
  maxBlocks?: bigint;
};

/**
 * One pass. Safe to call on a timer, safe to call twice: the unique `tx_hash`
 * makes a repeated range a no-op, and the caller holds an advisory lock anyway
 * so two passes do not spend requests on the same range.
 */
export async function scanPayments(opts: ScanOptions = {}): Promise<WatcherScan> {
  const started = Date.now();
  const cfg = watcherConfig();
  const priceWei = nodePriceWei();
  const payTo = paymentAddress();
  const deadline = started + (opts.budgetMs ?? cfg.budgetMs);

  const head = await rpc().getBlockNumber();
  const safeHead = head > cfg.confirmations ? head - cfg.confirmations : 0n;

  const cursor = await getCursor(PAYMENTS_CURSOR);
  const firstRun = cursor === null;
  const start = firstRun ? startingPoint(cfg, safeHead) : {from: cursor + 1n, note: ""};
  const notes: string[] = firstRun ? [start.note] : [];

  const base = (over: Partial<WatcherScan> = {}): WatcherScan => ({
    headBlock: head.toString(),
    safeHead: safeHead.toString(),
    indexedHead: null,
    fromBlock: null,
    toBlock: null,
    blocksScanned: 0,
    candidates: 0,
    transfersFound: 0,
    rejected: 0,
    unverified: 0,
    recorded: 0,
    duplicates: 0,
    manualReview: 0,
    behindBlocks: "0",
    caughtUp: true,
    firstRun,
    note: notes.length > 0 ? notes.join(" | ") : null,
    stopped: "no-work",
    discovery: "none",
    explorerRequests: 0,
    blockRequests: 0,
    degraded: false,
    degradedReason: null,
    durationMs: Date.now() - started,
    ...over,
  });

  if (start.from > safeHead) {
    // Ahead of the safe head: either nothing new, or the confirmation lag has
    // not cleared yet. Both are the same non-event.
    return report(base());
  }

  const found = await discover(payTo, start.from, safeHead, cfg, deadline);
  if (found.problem) notes.push(found.problem);

  // Verify in bounded parallel. Two RPC reads per candidate, and for the wallet
  // this watches there is usually nothing at all to verify.
  const verdicts = await inBatches(found.candidates, cfg.batchSize, (candidate) =>
    verify(candidate, priceWei, payTo, safeHead),
  );

  const sightings: PaymentSighting[] = [];
  let rejected = 0;
  let unverified = 0;
  let mismatched = 0;
  // Ground the pass may claim. A candidate the chain cannot confirm pulls it
  // back below that candidate's block, so the next pass looks at it again.
  let claim = found.coveredTo;

  for (const verdict of verdicts) {
    if (verdict.kind === "payment") {
      sightings.push(verdict.sighting);
      if (verdict.mismatch) mismatched++;
      continue;
    }
    if (verdict.kind === "rejected") {
      rejected++;
      continue;
    }
    unverified++;
    claim = min(claim, verdict.blockNumber - 1n);
  }

  sightings.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));

  // The trust ceiling. Discovery can answer a 60,000-block range in one request,
  // and that is exactly why one unattended pass may not erase 60,000 blocks of
  // cursor on the strength of a single "nothing there" from a third-party index.
  // A real gap is closed by more passes, or deliberately with fastForwardCursor().
  const ceiling = opts.maxBlocks ?? cfg.maxCatchupBlocks;
  const ceilingTo = start.from + ceiling - 1n;
  const clipped = claim > ceilingTo;
  const cursorTo = clipped ? ceilingTo : claim;
  const advanced = cursorTo >= start.from;

  const written = await commit(sightings, advanced ? cursorTo : null);

  const settled = advanced ? cursorTo : (cursor ?? start.from - 1n);
  // Two different distances. `behind` is the honest one, reported as such: how
  // far the cursor is from the chain. `behindDiscoverable` is the actionable
  // one: how far it is from the newest block anything could have been found in.
  // Confusing the two would have this watcher permanently declaring itself
  // behind because the index it reads is twenty seconds old.
  const indexLag =
    found.indexedHead === null ? null : head > found.indexedHead ? head - found.indexedHead : 0n;
  const discoverable = found.indexedHead === null ? safeHead : min(safeHead, found.indexedHead);
  const behind = settled >= safeHead ? 0n : safeHead - settled;
  const behindDiscoverable = settled >= discoverable ? 0n : discoverable - settled;

  const stopped: WatcherStop =
    found.stop !== null
      ? found.stop
      : unverified > 0
        ? "unverified"
        : clipped
          ? "catchup-ceiling"
          : behindDiscoverable === 0n
            ? "caught-up"
            : Date.now() >= deadline
              ? "time-budget"
              : "explorer-behind";

  // Degraded is about discovery working, not about being level with the head: a
  // pass that is behind but reading fine is healthy, and a pass that covered
  // nothing because the index was down is not, however small the gap. An index
  // that is seconds behind the chain is the normal state of an explorer and is
  // explicitly not a fault; one that is minutes behind is.
  const blind =
    stopped === "explorer-error" ||
    stopped === "page-limit" ||
    stopped === "rpc-error" ||
    (stopped === "explorer-behind" && (indexLag === null || indexLag > INDEX_LAG_TOLERANCE));

  // The fallback covering the range is not success. It read 58 blocks in 13
  // seconds in testing, which is slower than the chain produces them: it can
  // hold a quiet minute and nothing more, so the operator has to hear that the
  // index is down even when this pass happened to keep up without it.
  const onFallback = found.source === "rpc-fallback";
  const degraded = blind || onFallback || mismatched > 0;
  const degradedReason = !degraded
    ? null
    : blind || onFallback
      ? (found.problem ?? `payment discovery stopped on ${stopped}`)
      : `${mismatched} transaction(s) the explorer described differently from the chain, parked for review`;

  return report(
    base({
      indexedHead: found.indexedHead === null ? null : found.indexedHead.toString(),
      fromBlock: advanced ? start.from.toString() : null,
      toBlock: advanced ? cursorTo.toString() : null,
      blocksScanned: advanced ? Number(cursorTo - start.from + 1n) : 0,
      candidates: found.candidates.length,
      transfersFound: sightings.length,
      rejected,
      unverified,
      recorded: written.recorded,
      duplicates: written.duplicates,
      manualReview: written.manualReview,
      behindBlocks: behind.toString(),
      caughtUp: behindDiscoverable === 0n && !degraded,
      note: notes.length > 0 ? notes.join(" | ") : null,
      stopped,
      discovery: found.source,
      explorerRequests: found.explorerRequests,
      blockRequests: found.blockRequests,
      degraded,
      degradedReason,
      durationMs: Date.now() - started,
    }),
  );
}

/**
 * Put the pass's own verdict where a human will find it.
 *
 * The scan result goes back to whoever called the route, and nobody reads a
 * cron response. The alert is the part that survives until somebody looks, so a
 * blind watcher shows up on /admin next to everything else that is wrong.
 */
async function report(scan: WatcherScan): Promise<WatcherScan> {
  try {
    if (scan.degraded) {
      await raiseAlert(
        "payment_discovery",
        scan.degradedReason ?? "Payment discovery is not working.",
        {
          // `stop` only when the watcher is both stuck and meaningfully behind.
          // A single failed request while it is level with the head costs a few
          // seconds of lag, and paging somebody for that teaches them to ignore
          // the alert that matters.
          severity:
            scan.blocksScanned === 0 && BigInt(scan.behindBlocks) > INDEX_LAG_TOLERANCE
              ? "stop"
              : "warn",
          detail: {
            stopped: scan.stopped,
            discovery: scan.discovery,
            behindBlocks: scan.behindBlocks,
            indexedHead: scan.indexedHead,
            safeHead: scan.safeHead,
          },
        },
      );
    } else {
      await clearAlert("payment_discovery");
    }
  } catch (err) {
    // A pass that found payments must not be undone by a failed alert write.
    console.error("[watcher] alert bookkeeping failed:", firstLine(err));
  }
  return scan;
}

/* ----------------------------------------------------------------- status */

export type WatcherHealth = {
  cursor: string | null;
  headBlock: string;
  behindBlocks: string;
  /** The gap in the unit an operator thinks in, at the chain's measured rate. */
  behindSeconds: number;
  pendingPayments: number;
  /** Whether the address index answered just now. */
  explorerOk: boolean;
  /** One safe sentence when it did not. Never an upstream body. */
  explorerError: string | null;
  indexedHead: string | null;
  /** How far the explorer's index is behind the chain head. */
  indexLagBlocks: string | null;
};

/**
 * Where the watcher stands, without running a pass. For the admin console and
 * the health endpoint, which need to say "twenty minutes behind, explorer fine"
 * without paying for a scan to find out.
 */
export async function watcherStatus(): Promise<WatcherHealth> {
  const [cursor, head, rows, index] = await Promise.all([
    getCursor(PAYMENTS_CURSOR),
    rpc().getBlockNumber(),
    sql<{n: string}>`select count(*)::text as n from payments where status in ('seen','failed')`,
    // A probe, not a scan: one request, and a failure is a finding rather than
    // an error, because "is the explorer up" is precisely what is being asked.
    indexedHead().then(
      (value) => ({value, error: null as string | null}),
      (err: unknown) => ({
        value: null,
        error: err instanceof ExplorerError ? err.message : "explorer unreachable",
      }),
    ),
  ]);

  const behind = cursor === null || head <= cursor ? 0n : head - cursor;
  return {
    cursor: cursor === null ? null : cursor.toString(),
    headBlock: head.toString(),
    behindBlocks: behind.toString(),
    behindSeconds: Math.round(Number(behind) / BLOCKS_PER_SECOND),
    pendingPayments: Number(rows[0]?.n ?? 0),
    explorerOk: index.error === null,
    explorerError: index.error,
    indexedHead: index.value === null ? null : index.value.toString(),
    indexLagBlocks:
      index.value === null ? null : (head > index.value ? head - index.value : 0n).toString(),
  };
}

/* ----------------------------------------------------------- fast forward */

/** The one phrase that authorises skipping ground. Typed by a human, never defaulted. */
export const FAST_FORWARD_CONFIRM = "fast-forward-payment-cursor";

export type FastForwardResult = {
  moved: boolean;
  /** Why not, in one sentence, when `moved` is false. */
  refusal: string | null;
  cursorBefore: string | null;
  cursorAfter: string | null;
  skippedBlocks: string;
  safeHead: string;
  indexedHead: string | null;
  /** Transactions the index found in the range that would have been skipped. */
  transfersInRange: number;
  walletBalanceWei: string | null;
  recordedPayments: number;
};

/**
 * Move the cursor forward over a range, deliberately.
 *
 * WHY THIS IS NOT PART OF A PASS. A normal pass may claim only
 * WATCHER_MAX_CATCHUP_BLOCKS at a time, on purpose: an index that answers
 * "nothing there" for a range it never read looks exactly like an empty range,
 * and unattended code should not be able to write off a day of chain on that
 * evidence. Closing a large gap is a decision, so a person takes it once, with a
 * target block they had to type.
 *
 * It is still not taken on trust. Before the cursor moves, this proves the
 * skipped range empty every way available: the address index must answer for the
 * whole range and find nothing in it, the explorer must have indexed past the
 * target, and the wallet must not be holding ETH that no recorded payment
 * accounts for. Any doubt is a refusal, never a warning.
 */
export async function fastForwardCursor(args: {
  confirm: string;
  toBlock: bigint;
}): Promise<FastForwardResult> {
  if (args.confirm !== FAST_FORWARD_CONFIRM) {
    // An operator typo is caught by the route with a 400. Reaching here means
    // some other code called this by accident, which is a bug, not a request.
    throw new Error("fastForwardCursor requires the explicit confirmation phrase");
  }

  const cfg = watcherConfig();
  const payTo = paymentAddress();
  const client = rpc();

  const head = await client.getBlockNumber();
  const safeHead = head > cfg.confirmations ? head - cfg.confirmations : 0n;
  const cursor = await getCursor(PAYMENTS_CURSOR);

  const refuse = (reason: string, over: Partial<FastForwardResult> = {}): FastForwardResult => ({
    moved: false,
    refusal: reason,
    cursorBefore: cursor === null ? null : cursor.toString(),
    cursorAfter: null,
    skippedBlocks: "0",
    safeHead: safeHead.toString(),
    indexedHead: null,
    transfersInRange: 0,
    walletBalanceWei: null,
    recordedPayments: 0,
    ...over,
  });

  if (cursor === null) {
    return refuse("there is no cursor yet; the next pass sets one from WATCHER_START_BLOCK");
  }
  if (args.toBlock <= cursor) {
    return refuse(`toBlock must be above the current cursor ${cursor.toString()}`);
  }
  if (args.toBlock > safeHead) {
    return refuse(`toBlock must be at or below the safe head ${safeHead.toString()}`);
  }

  let indexHead: bigint;
  try {
    indexHead = await indexedHead(cfg.explorerTimeoutMs);

  } catch {
    return refuse("the explorer is unreachable, so the range cannot be shown to be empty");
  }
  if (indexHead < args.toBlock) {
    return refuse(
      `the explorer has only indexed to block ${indexHead.toString()}, below the requested target`,
      {indexedHead: indexHead.toString()},
    );
  }

  const from = cursor + 1n;
  // Generous page limit: this runs once, by hand, and a partial answer is a
  // refusal rather than something to work around. Both endpoints are tried for
  // the same reason the watcher tries both — v1 is rate limited hard enough that
  // a single earlier call can make it say no.
  const walkOpts = {pageSize: cfg.explorerPageSize, maxPages: 50, timeoutMs: cfg.explorerTimeoutMs};
  let walk;
  try {
    walk = await walkAddressV2(payTo, from, args.toBlock, walkOpts);
  } catch {
    try {
      walk = await walkTxlist(payTo, from, args.toBlock, walkOpts);
    } catch {
      return refuse("the explorer could not answer for the whole range", {
        indexedHead: indexHead.toString(),
      });
    }
  }
  if (!walk.complete) {
    return refuse("the explorer did not return the whole range in one go", {
      indexedHead: indexHead.toString(),
    });
  }
  if (walk.transfers.length > 0) {
    return refuse(
      `the range is not empty: ${walk.transfers.length} transfer(s) to the payments wallet are in it. ` +
        `Let the watcher scan them instead of skipping them.`,
      {indexedHead: indexHead.toString(), transfersInRange: walk.transfers.length},
    );
  }

  const [balance, rows] = await Promise.all([
    client.getBalance({address: payTo}),
    sql<{n: string}>`select count(*)::text as n from payments`,
  ]);
  const recorded = Number(rows[0]?.n ?? 0);

  // The wallet holds money that no payment row explains. Something arrived that
  // was never recorded, and skipping the range would bury it.
  if (balance > 0n && recorded === 0) {
    return refuse(
      "the payments wallet holds ETH but no payment has ever been recorded; investigate before skipping",
      {
        indexedHead: indexHead.toString(),
        walletBalanceWei: balance.toString(),
        recordedPayments: 0,
      },
    );
  }

  await setCursor(args.toBlock, PAYMENTS_CURSOR);
  // An audit line for a manual change to the money pipeline. No key, no body.
  console.warn(
    `[watcher] payments cursor fast-forwarded ${cursor.toString()} -> ${args.toBlock.toString()} ` +
      `(${(args.toBlock - cursor).toString()} blocks, index confirmed empty)`,
  );

  return {
    moved: true,
    refusal: null,
    cursorBefore: cursor.toString(),
    cursorAfter: args.toBlock.toString(),
    skippedBlocks: (args.toBlock - cursor).toString(),
    safeHead: safeHead.toString(),
    indexedHead: indexHead.toString(),
    transfersInRange: 0,
    walletBalanceWei: balance.toString(),
    recordedPayments: recorded,
  };
}
