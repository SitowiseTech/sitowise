/**
 * Read-only chain access for server code.
 *
 * Every server decision that involves money is taken from the chain, not from
 * the request body: who owns a node, how much it has been credited, how much it
 * has already paid out, whether a transaction actually succeeded. A client can
 * lie about all of those; an RPC node cannot without the whole chain lying with
 * it.
 *
 * There is deliberately no wallet here. This module only reads. The two
 * accounts that write (relayer, distributor) live behind lib/env.ts and are
 * used by the worker, and a node's balance can only ever be moved by its own
 * owner's wallet.
 */

import {
  createPublicClient,
  http,
  parseEventLogs,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  type Hash,
  type Transaction,
  type TransactionReceipt,
} from "viem";
import {FACTORY_ABI} from "@/lib/abi";
import {RPC_URL, robinhoodChain} from "@/lib/chain";
import {factoryAddress} from "@/lib/env";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/* ------------------------------------------------------------------ client */

function build() {
  return createPublicClient({
    chain: robinhoodChain,
    // A public RPC drops the occasional request. Two retries turn that into a
    // slow response instead of a failed mint preflight; the timeout keeps a
    // hung node from holding a serverless invocation open to its own limit.
    transport: http(RPC_URL, {timeout: 15_000, retryCount: 2, retryDelay: 250}),
  });
}

// On globalThis so dev hot reloads reuse one client rather than leaking one per edit.
const globalForRpc = globalThis as unknown as {__sitowiseRpc?: ReturnType<typeof build>};

export function rpc(): ReturnType<typeof build> {
  return (globalForRpc.__sitowiseRpc ??= build());
}

/** `{address, abi}` for the deployed factory. Throws if NEXT_PUBLIC_FACTORY is unset. */
export function factoryContract() {
  return {address: factoryAddress(), abi: FACTORY_ABI} as const;
}

/* ------------------------------------------------------------------- reads */

/**
 * ETH the factory holds. Compared against `outstanding` this is the solvency
 * check; on its own it is not, because part of it may belong to no node.
 */
export function contractBalanceWei(): Promise<bigint> {
  return rpc().getBalance({address: factoryAddress()});
}

/** Everything the contract stores about one node. */
export type NodeInfo = {
  /** Lowercased, or null when the id has never been minted. */
  owner: `0x${string}` | null;
  createdAt: bigint;
  /** Withdrawable right now. */
  balanceWei: bigint;
  /** Credited over the node's whole life. */
  totalReceivedWei: bigint;
  /** Paid out over the node's whole life. */
  totalWithdrawnWei: bigint;
};

/**
 * One node in one call. Everything a server-side check needs about a node comes
 * from here, so an ownership test and a balance test always agree with each
 * other instead of straddling two blocks.
 */
export async function nodeInfo(chainNodeId: bigint): Promise<NodeInfo> {
  const [owner, createdAt, balance, totalReceived, totalWithdrawn] = await rpc().readContract({
    ...factoryContract(),
    functionName: "nodeInfo",
    args: [chainNodeId],
  });
  return {
    // The contract returns the zero address for an id it has never minted
    // rather than reverting, so that is the only "does not exist" signal.
    owner: owner.toLowerCase() === ZERO_ADDRESS ? null : (owner.toLowerCase() as `0x${string}`),
    createdAt,
    balanceWei: balance,
    totalReceivedWei: totalReceived,
    totalWithdrawnWei: totalWithdrawn,
  };
}

/** On-chain owner of a node, or null when the id has never been minted. */
export async function ownerOfNode(chainNodeId: bigint): Promise<`0x${string}` | null> {
  return (await nodeInfo(chainNodeId)).owner;
}

/** Cumulative wei the contract has already paid out for one node. */
export async function withdrawnByNode(chainNodeId: bigint): Promise<bigint> {
  return (await nodeInfo(chainNodeId)).totalWithdrawnWei;
}

/** Highest node id the contract has minted. Ids run 1..totalNodes with no gaps. */
export function chainTotalNodes(): Promise<bigint> {
  return rpc().readContract({...factoryContract(), functionName: "totalNodes"});
}

/** Every node id the contract attributes to this wallet. */
export async function chainNodesOf(owner: `0x${string}`): Promise<bigint[]> {
  const ids = await rpc().readContract({
    ...factoryContract(),
    functionName: "nodesOf",
    args: [owner],
  });
  return [...ids];
}

/**
 * Whether a payment transaction hash has already been minted against.
 *
 * The watcher checks this before asking the relayer to mint. Without it a
 * retried watcher run would send a `mintFor` that reverts with RefAlreadyUsed
 * and burns gas to learn what one read could have told it.
 */
export function paymentRefUsed(paymentRef: `0x${string}`): Promise<boolean> {
  return rpc().readContract({
    ...factoryContract(),
    functionName: "paymentRefUsed",
    args: [paymentRef],
  });
}

/* ---------------------------------------------------------------- receipts */

/**
 * Receipt for `hash`, or null when the chain has never heard of it.
 *
 * `waitMs > 0` waits for a pending transaction to land, which is what the sync
 * route wants: the browser may call before the node has indexed it. Only "not
 * found" and "still pending" become null; an unreachable RPC still throws,
 * because answering "no such transaction" during an outage would tell the user
 * their node was never created when it was.
 */
export async function receiptFor(hash: Hash, waitMs = 0): Promise<TransactionReceipt | null> {
  try {
    return await rpc().getTransactionReceipt({hash});
  } catch (err) {
    if (!(err instanceof TransactionReceiptNotFoundError)) throw err;
  }

  if (waitMs <= 0) return null;

  try {
    return await rpc().waitForTransactionReceipt({hash, timeout: waitMs, confirmations: 1});
  } catch (err) {
    if (err instanceof WaitForTransactionReceiptTimeoutError) return null;
    if (err instanceof TransactionReceiptNotFoundError) return null;
    throw err;
  }
}

/**
 * The transaction itself, or null when unknown. The payment watcher needs it:
 * a plain transfer emits no logs, so its value and recipient can only be read
 * off the transaction.
 */
export async function transactionFor(hash: Hash): Promise<Transaction | null> {
  try {
    return await rpc().getTransaction({hash});
  } catch (err) {
    if (err instanceof TransactionNotFoundError) return null;
    throw err;
  }
}

/* ------------------------------------------------------------------- logs */

export type MintedLog = {
  chainNodeId: bigint;
  owner: `0x${string}`;
  /**
   * Hash of the payment transfer this node was minted against. Unique per node
   * on chain, so it is the audit link from a node back to the money that
   * bought it. It is NOT an amount: the contract never saw one.
   */
  paymentRef: `0x${string}`;
  createdAt: bigint;
  /** Hash of the relayer's `mintFor`, not of the payment. */
  txHash: `0x${string}`;
  blockNumber: bigint | null;
};

export type WithdrawnLog = {
  chainNodeId: bigint;
  to: `0x${string}`;
  amountWei: bigint;
  txHash: `0x${string}`;
};

/**
 * Only logs the factory itself emitted are worth decoding. Any contract can
 * emit a payload with the NodeMinted topic, so an unfiltered parse of a receipt
 * would let a call to an attacker's contract register nodes it never minted.
 */
function factoryLogs(receipt: TransactionReceipt) {
  const address = factoryAddress().toLowerCase();
  return receipt.logs.filter((log) => log.address.toLowerCase() === address);
}

export function mintsInReceipt(receipt: TransactionReceipt): MintedLog[] {
  const events = parseEventLogs({
    abi: FACTORY_ABI,
    eventName: "NodeMinted",
    logs: factoryLogs(receipt),
  });
  return events.map((event) => ({
    chainNodeId: event.args.id,
    owner: event.args.owner.toLowerCase() as `0x${string}`,
    paymentRef: event.args.paymentRef,
    createdAt: BigInt(event.args.createdAt),
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber ?? null,
  }));
}

/**
 * Withdrawals in a receipt. `withdrawAll` emits one Withdrawn per node it
 * emptied, so a single transaction legitimately yields several rows.
 */
export function withdrawalsInReceipt(receipt: TransactionReceipt): WithdrawnLog[] {
  const events = parseEventLogs({
    abi: FACTORY_ABI,
    eventName: "Withdrawn",
    logs: factoryLogs(receipt),
  });
  return events.map((event) => ({
    chainNodeId: event.args.id,
    to: event.args.to.toLowerCase() as `0x${string}`,
    amountWei: event.args.amount,
    txHash: receipt.transactionHash,
  }));
}

/** The NodeMinted entry from the generated ABI, so the topic can never drift from it. */
type NodeMintedAbiItem = Extract<(typeof FACTORY_ABI)[number], {type: "event"; name: "NodeMinted"}>;

function nodeMintedEvent(): NodeMintedAbiItem {
  const item = FACTORY_ABI.find(
    (entry): entry is NodeMintedAbiItem => entry.type === "event" && entry.name === "NodeMinted",
  );
  if (!item) throw new Error("SitowiseFactory ABI has no NodeMinted event");
  return item;
}

export type MintLogScan = {
  logs: MintedLog[];
  /** How many eth_getLogs calls it took, including the ones that had to be split. */
  requests: number;
  /** The range actually covered, with `toBlock` resolved if the caller left it open. */
  fromBlock: bigint;
  toBlock: bigint;
};

/** Indexed fields of NodeMinted: the only ones an RPC node can filter on. */
type MintLogFilter = {id?: bigint[]; owner?: `0x${string}`[]};

/**
 * One topic-filtered scan of NodeMinted, halving the range on failure.
 *
 * The filter is always on an indexed field, so the node answers from its log
 * index rather than by walking blocks. That is why the default range is the
 * entire chain: on Robinhood Chain a full-range query against a low-traffic
 * address returns in well under a second, while the same query against a busy
 * contract times out. If a range ever does fail, it is halved and retried, down
 * to `minSpan`, so a growing chain degrades into more requests instead of an
 * error.
 */
async function scanMintLogs(
  filter: MintLogFilter,
  opts: {fromBlock?: bigint; toBlock?: bigint; minSpan?: bigint} = {},
): Promise<MintLogScan> {
  const client = rpc();
  const fromBlock = opts.fromBlock ?? 0n;
  const toBlock = opts.toBlock ?? (await client.getBlockNumber());

  const minSpan = opts.minSpan ?? 50_000n;
  const event = nodeMintedEvent();
  const address = factoryAddress();

  const collected: MintedLog[] = [];
  let requests = 0;

  const scan = async (lo: bigint, hi: bigint): Promise<void> => {
    requests++;
    let logs;
    try {
      logs = await client.getLogs({
        address,
        event,
        args: filter,
        fromBlock: lo,
        toBlock: hi,
        // Drop anything whose topics do not match the event exactly rather than
        // decoding it loosely into undefined args.
        strict: true,
      });
    } catch (err) {
      const span = hi - lo;
      if (span <= minSpan) throw err;
      const mid = lo + span / 2n;
      await scan(lo, mid);
      await scan(mid + 1n, hi);
      return;
    }

    for (const log of logs) {
      // A pending log has null block and transaction fields; nothing to record.
      if (log.transactionHash === null) continue;
      collected.push({
        chainNodeId: log.args.id,
        owner: log.args.owner.toLowerCase() as `0x${string}`,
        paymentRef: log.args.paymentRef,
        createdAt: BigInt(log.args.createdAt),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      });
    }
  };

  await scan(fromBlock, toBlock);
  return {logs: collected, requests, fromBlock, toBlock};
}

/**
 * Find the mint logs for specific node ids. `id` is indexed, so the whole set
 * goes into one topic filter.
 */
export async function mintLogsForIds(
  ids: bigint[],
  opts: {fromBlock?: bigint; toBlock?: bigint; minSpan?: bigint} = {},
): Promise<MintLogScan> {
  if (ids.length === 0) {
    const client = rpc();
    const fromBlock = opts.fromBlock ?? 0n;
    const toBlock = opts.toBlock ?? (await client.getBlockNumber());
    return {logs: [], requests: 0, fromBlock, toBlock};
  }
  return scanMintLogs({id: ids}, opts);
}

/**
 * Every node one wallet has ever been minted, newest last.
 *
 * The mint relay needs this to answer one question: which node already exists
 * for a payment whose `paymentRef` the contract has seen before. `paymentRef`
 * is NOT indexed, so it cannot be filtered on; `owner` is, and the buyer's
 * address is known from the payment transaction. A handful of logs come back
 * and the ref is matched in memory.
 */
export function mintLogsForOwner(
  owner: `0x${string}`,
  opts: {fromBlock?: bigint; toBlock?: bigint; minSpan?: bigint} = {},
): Promise<MintLogScan> {
  return scanMintLogs({owner: [owner.toLowerCase() as `0x${string}`]}, opts);
}
