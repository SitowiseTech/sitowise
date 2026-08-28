/**
 * The mint relay: recorded payments become nodes on chain.
 *
 * This is the only place the relayer key is used, and the only thing it can do
 * with it is call `mintFor`. A leak costs free nodes and nothing else: the
 * relayer cannot credit a balance, cannot withdraw one, and cannot move a wei
 * of anybody's money.
 *
 * It works exclusively from rows lib/watcher.ts has already committed. Nothing
 * is minted from a request, a body, or a hash somebody handed us — the queue is
 * the only input, and every row in it is re-checked against the chain before a
 * transaction is sent, because the row is a copy and the chain is the original.
 *
 * THE RETRY RULE THAT MATTERS. `mintFor` reverting with `RefAlreadyUsed` is not
 * a failure. It is the contract telling us the node for this payment already
 * exists, which is exactly what a retry after a lost receipt looks like. The
 * correct response is to go find that node's id and mark the payment minted, not
 * to raise an alarm and certainly not to keep retrying. Every path below that
 * can produce it treats it as success:
 *
 *   * before simulating, `paymentRefUsed` is read, so the usual retry costs one
 *     eth_call and no gas at all;
 *   * the simulation is inspected for the custom error, which closes the race
 *     between that read and the send;
 *   * a reverted send is re-checked the same way, in case two passes overlapped.
 */

import {randomInt} from "node:crypto";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  http,
  type PrivateKeyAccount,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {FACTORY_ABI} from "@/lib/abi";
import {robinhoodChain, RPC_URL} from "@/lib/chain";
import {distConfig, factoryAddress, nodePriceWei, paymentAddress, relayerPrivateKey} from "@/lib/env";
import {
  claimForMinting,
  markManualReview,
  markMintFailed,
  markMinted,
  type PaymentRow,
} from "@/lib/payments";
import {recordMintedNodes} from "@/lib/reconcile";
import {
  mintLogsForOwner,
  mintsInReceipt,
  paymentRefUsed,
  rpc,
  transactionFor,
  type MintedLog,
} from "@/lib/rpc";
import {scheduleNewNode} from "@/lib/schedule";
import {loadTiers, tierById, tierUsageFor} from "@/lib/tiers";

/** Long enough for a slow block, short enough that a pass cannot hang forever. */
const RECEIPT_TIMEOUT_MS = 90_000;

/**
 * What became of one payment in this pass.
 *
 * `already-minted` is a success, listed separately only so the operator can see
 * a retry resolving itself rather than reading it as a fresh sale.
 */
export type MintStatus = "minted" | "already-minted" | "failed" | "manual_review";

export type MintOutcome = {
  paymentId: string;
  /** The payment transfer's hash, which is also the on-chain `paymentRef`. */
  paymentTx: string;
  owner: string;
  status: MintStatus;
  nodeChainId?: string;
  /** Hash of the relayer's `mintFor`, never of the payment. */
  mintTx?: string;
  /** One sentence, safe to log. Never contains a key or a stack trace. */
  reason?: string;
};

export type MintRelayResult = {
  claimed: number;
  minted: number;
  alreadyMinted: number;
  failed: number;
  manualReview: number;
  /** True when the batch limit or the time budget cut the pass short. */
  more: boolean;
  outcomes: MintOutcome[];
};

export type RelayOptions = {
  /** Payments to attempt in one pass. Defaults to WATCHER_MINT_BATCH. */
  limit?: number;
  /** Wall-clock budget. A pass stops cleanly rather than being killed mid-receipt. */
  budgetMs?: number;
};

/* ---------------------------------------------------------------- account */

let cachedAccount: PrivateKeyAccount | null = null;

/** The relayer account. Cached: deriving an address from a key is not free. */
function relayerAccount(): PrivateKeyAccount {
  if (!cachedAccount) cachedAccount = privateKeyToAccount(relayerPrivateKey());
  return cachedAccount;
}

/** Address of the configured relayer, for /admin. Never returns the key. */
export function relayerAddress(): `0x${string}` {
  return relayerAccount().address.toLowerCase() as `0x${string}`;
}

function wallet(account: PrivateKeyAccount) {
  return createWalletClient({account, chain: robinhoodChain, transport: http(RPC_URL)});
}

/* ----------------------------------------------------------------- errors */

/**
 * The contract's own error name behind a viem failure, or null when the failure
 * was not a revert. Custom errors are the only way to tell `RefAlreadyUsed`
 * (success in disguise) from `WalletLimit` (a refund) from `IsPaused` (wait).
 */
function revertName(err: unknown): string | null {
  if (!(err instanceof BaseError)) return null;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? (revert.data?.errorName ?? null) : null;
}

/** One line, no stack, no request dump. What goes in `payments.last_error`. */
function firstLine(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  return (err instanceof Error ? err.message : String(err)).split("\n")[0];
}

/* -------------------------------------------------------------- scheduling */

/**
 * A node's first timer, drawn per node rather than shared. Two nodes bought in
 * the same minute must not then be paid in lockstep forever, and the desync has
 * to start at the mint or it never starts at all.
 */
function firstDelaySeconds(): number {
  const {minDelaySec, maxDelaySec} = distConfig();
  // randomInt's upper bound is exclusive; the configured maximum is meant to be
  // reachable.
  return randomInt(minDelaySec, maxDelaySec + 1);
}

/**
 * Everything that follows a node existing on chain, in the order that survives
 * a crash best: the timer, then the ledger row, then the payment marked done.
 *
 * The payment row is marked last on purpose. A process that dies halfway leaves
 * the payment looking unfinished, so the next pass retries it, lands on the
 * `RefAlreadyUsed` path and completes the same steps — which are all idempotent.
 * Marking it first would leave a paid node with no timer and nothing to notice.
 */
async function settle(row: PaymentRow, mint: MintedLog): Promise<void> {
  await scheduleNewNode(mint.chainNodeId, firstDelaySeconds());
  await recordMintedNodes([mint]);
  await markMinted({id: row.id, nodeChainId: mint.chainNodeId, mintTxHash: mint.txHash});
}

/* ------------------------------------------------------------- one payment */

/**
 * The node that was already minted for this payment, found through the buyer's
 * own mint logs. `paymentRef` is not an indexed event field so it cannot be
 * filtered on directly; `owner` is, and a buyer has at most `maxPerWallet` nodes,
 * so the match is done in memory over a handful of logs.
 */
async function existingNodeFor(
  owner: `0x${string}`,
  ref: `0x${string}`,
): Promise<MintedLog | null> {
  const scan = await mintLogsForOwner(owner);
  return scan.logs.find((log) => log.paymentRef.toLowerCase() === ref) ?? null;
}

/**
 * Re-read the payment from the chain.
 *
 * The queue row was written by the watcher from this same transaction, so this
 * should always agree — and that is the point. It is one eth_call standing
 * between a corrupted or hand-edited row and a free node, on the only code path
 * that gives value away. The owner returned here is the address that actually
 * sent the money, which is the address the node is minted to; nothing else is
 * ever consulted for it.
 */
type Verified =
  | {ok: true; owner: `0x${string}`}
  | {ok: false; retry: boolean; reason: string};

async function verifyPayment(row: PaymentRow): Promise<Verified> {
  const ref = row.tx_hash as `0x${string}`;
  const transaction = await transactionFor(ref);
  if (!transaction) {
    // Not a lie, usually a lag or a reorg. Retry until the attempt budget is
    // spent, and only then let a human look at it.
    return {ok: false, retry: true, reason: "payment transaction not visible on chain yet"};
  }

  if (transaction.to?.toLowerCase() !== paymentAddress()) {
    return {ok: false, retry: false, reason: "payment was not addressed to the payments wallet"};
  }

  const priceWei = nodePriceWei();
  if (transaction.value !== priceWei) {
    return {
      ok: false,
      retry: false,
      reason: `on-chain amount ${transaction.value.toString()} wei is not the ${priceWei.toString()} wei node price`,
    };
  }

  const owner = transaction.from.toLowerCase() as `0x${string}`;
  if (owner !== row.from_address.toLowerCase()) {
    return {ok: false, retry: false, reason: "recorded sender does not match the transaction"};
  }

  return {ok: true, owner};
}

/** Resolve a payment whose ref the contract has already seen. Never an error. */
async function resolveAlreadyMinted(
  row: PaymentRow,
  owner: `0x${string}`,
  ref: `0x${string}`,
): Promise<MintOutcome> {
  const existing = await existingNodeFor(owner, ref);
  if (!existing) {
    // The contract says the ref is used but its log has not surfaced yet, which
    // a fresh reorg or a lagging index can both cause. Nothing is invented: the
    // row is left to the retry path, which will find it moments later.
    await markMintFailed({
      id: row.id,
      error: "payment already minted on chain but its NodeMinted log was not found yet",
    });
    return {
      paymentId: row.id,
      paymentTx: row.tx_hash,
      owner,
      status: "failed",
      reason: "node exists on chain, waiting for its mint log",
    };
  }

  await settle(row, existing);
  return {
    paymentId: row.id,
    paymentTx: row.tx_hash,
    owner,
    status: "already-minted",
    nodeChainId: existing.chainNodeId.toString(),
    mintTx: existing.txHash,
  };
}

async function mintOne(row: PaymentRow, account: PrivateKeyAccount): Promise<MintOutcome> {
  const ref = row.tx_hash.toLowerCase() as `0x${string}`;
  const client = rpc();

  const verified = await verifyPayment(row);
  if (!verified.ok) {
    if (verified.retry) {
      await markMintFailed({id: row.id, error: verified.reason});
      return {
        paymentId: row.id,
        paymentTx: row.tx_hash,
        owner: row.from_address,
        status: "failed",
        reason: verified.reason,
      };
    }
    await markManualReview({id: row.id, reason: verified.reason});
    return {
      paymentId: row.id,
      paymentTx: row.tx_hash,
      owner: row.from_address,
      status: "manual_review",
      reason: verified.reason,
    };
  }

  const owner = verified.owner;

  // One read before any gas is spent. A retry after a lost receipt is the
  // ordinary case, not the exception, and this is what makes it cost nothing.
  if (await paymentRefUsed(ref)) return resolveAlreadyMinted(row, owner, ref);

  // The allowance, checked again here and not only at discovery.
  //
  // Discovery verifies a batch of candidates concurrently, so several payments
  // from one wallet can each read the same free allowance and all pass. This
  // loop is sequential and every mint marks its payment before the next one is
  // looked at, so it is the point where the count is finally true.
  {
    const {tiers} = await loadTiers();
    const tier = tierById(row.tier, tiers);
    const used = (await tierUsageFor(owner))[tier.id];
    // Minus one: this payment is itself counted in `used`, and it is the one
    // asking for the slot rather than occupying it.
    if (used - 1 >= tier.maxPerWallet) {
      const reason =
        `this wallet is at the ${tier.label} allowance of ${tier.maxPerWallet}; ` +
        "the payment needs refunding rather than minting";
      await markManualReview({id: row.id, reason});
      return {
        paymentId: row.id,
        paymentTx: row.tx_hash,
        owner,
        status: "manual_review",
        reason,
      };
    }
  }

  let request;
  try {
    ({request} = await client.simulateContract({
      account,
      address: factoryAddress(),
      abi: FACTORY_ABI,
      functionName: "mintFor",
      args: [owner, ref],
    }));
  } catch (err) {
    const name = revertName(err);

    // The read above missed it by a block, or a parallel pass got there first.
    if (name === "RefAlreadyUsed") return resolveAlreadyMinted(row, owner, ref);

    // No retry can fix a wallet that is already full: it needs a refund or a
    // different address, and both are decisions a person makes.
    if (name === "WalletLimit") {
      const reason = "buyer already holds the maximum number of nodes; refund or mint elsewhere";
      await markManualReview({id: row.id, reason});
      return {paymentId: row.id, paymentTx: row.tx_hash, owner, status: "manual_review", reason};
    }

    // IsPaused and NotRelayer are both operator conditions that clear on their
    // own or on a config change, so they take the bounded retry path.
    const reason = name ?? firstLine(err);
    await markMintFailed({id: row.id, error: `mintFor simulation failed: ${reason}`});
    return {paymentId: row.id, paymentTx: row.tx_hash, owner, status: "failed", reason};
  }

  const hash = await wallet(account).writeContract(request);
  const receipt = await client.waitForTransactionReceipt({hash, timeout: RECEIPT_TIMEOUT_MS});

  if (receipt.status !== "success") {
    // Simulated fine and reverted anyway: the only realistic cause is another
    // pass minting the same ref in between, so ask the contract before alarming.
    if (await paymentRefUsed(ref)) return resolveAlreadyMinted(row, owner, ref);
    const reason = `mintFor ${hash} reverted on chain`;
    await markMintFailed({id: row.id, error: reason});
    return {paymentId: row.id, paymentTx: row.tx_hash, owner, status: "failed", reason};
  }

  // The id comes from the factory's own log in this receipt, not from the
  // simulation's return value: the log is what an explorer will show, and the
  // two can only differ if something is very wrong.
  const mint = mintsInReceipt(receipt).find((log) => log.paymentRef.toLowerCase() === ref);
  if (!mint) {
    const reason = `mintFor ${hash} confirmed without a NodeMinted log for this payment`;
    await markMintFailed({id: row.id, error: reason});
    return {paymentId: row.id, paymentTx: row.tx_hash, owner, status: "failed", reason};
  }

  await settle(row, mint);
  return {
    paymentId: row.id,
    paymentTx: row.tx_hash,
    owner,
    status: "minted",
    nodeChainId: mint.chainNodeId.toString(),
    mintTx: hash,
  };
}

/* ------------------------------------------------------------------- pass */

const EMPTY: MintRelayResult = {
  claimed: 0,
  minted: 0,
  alreadyMinted: 0,
  failed: 0,
  manualReview: 0,
  more: false,
  outcomes: [],
};

/**
 * Confirm the key we hold is the one the contract obeys.
 *
 * `mintFor` is restricted to the stored `relayer`, so a rotated role or a
 * mistyped key would otherwise burn one failed attempt per payment per pass
 * until every sale in the queue hit the attempt ceiling and landed in manual
 * review. One eth_call turns that into a single clear sentence.
 */
async function relayerIsAuthorised(account: PrivateKeyAccount): Promise<string | null> {
  const onChain = await rpc().readContract({
    address: factoryAddress(),
    abi: FACTORY_ABI,
    functionName: "relayer",
  });
  const mine = account.address.toLowerCase();
  if (mine === onChain.toLowerCase()) return null;
  return `RELAYER_PRIVATE_KEY (${mine}) is not the factory's relayer (${onChain.toLowerCase()})`;
}

/**
 * Mint every payment that is due, up to the batch and time budgets.
 *
 * Sequential on purpose. Two `mintFor` calls in flight from one account share a
 * nonce and one of them is dropped; a dropped mint would then look like a
 * failure and be retried, which works but wastes a pass. Payments are rare
 * enough that serial sending costs nothing worth having.
 */
export async function runMintRelay(opts: RelayOptions = {}): Promise<MintRelayResult> {
  const limit = opts.limit ?? 5;
  const deadline = opts.budgetMs === undefined ? null : Date.now() + opts.budgetMs;

  const claimed = await claimForMinting(limit);
  if (claimed.length === 0) return EMPTY;

  const account = relayerAccount();
  const problem = await relayerIsAuthorised(account);
  if (problem) {
    // Put every claimed row back with the reason on it instead of sending
    // transactions that cannot succeed.
    for (const row of claimed) await markMintFailed({id: row.id, error: problem});
    console.error("[mintRelay]", problem);
    return {
      ...EMPTY,
      claimed: claimed.length,
      failed: claimed.length,
      outcomes: claimed.map((row) => ({
        paymentId: row.id,
        paymentTx: row.tx_hash,
        owner: row.from_address,
        status: "failed" as const,
        reason: "relayer key is not the factory's relayer",
      })),
    };
  }

  const outcomes: MintOutcome[] = [];
  let more = false;

  for (const row of claimed) {
    if (deadline !== null && Date.now() >= deadline) {
      // Out of time with rows still claimed. They stay in `minting` and
      // requeueStuckMinting hands them back on a later pass; nothing is lost,
      // and stopping here beats being killed between send and receipt.
      more = true;
      break;
    }

    try {
      outcomes.push(await mintOne(row, account));
    } catch (err) {
      // Anything unforeseen: an RPC outage, a nonce clash, a dropped socket.
      // Bounded retries, one line in the row, full detail only in the log.
      const reason = firstLine(err);
      console.error(`[mintRelay] payment ${row.id}:`, reason);
      await markMintFailed({id: row.id, error: reason});
      outcomes.push({
        paymentId: row.id,
        paymentTx: row.tx_hash,
        owner: row.from_address,
        status: "failed",
        reason,
      });
    }
  }

  const count = (status: MintStatus) => outcomes.filter((o) => o.status === status).length;

  return {
    claimed: claimed.length,
    minted: count("minted"),
    alreadyMinted: count("already-minted"),
    failed: count("failed"),
    manualReview: count("manual_review"),
    more: more || claimed.length === limit,
    outcomes,
  };
}
