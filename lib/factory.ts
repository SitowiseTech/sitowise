/**
 * Reading and calling SitowiseFactory from the browser.
 *
 * The browser's whole write surface is two calls: `withdraw` and `withdrawAll`.
 * Minting is not here, because a user never mints. Payment is a plain transfer
 * to the payments wallet and the relayer mints against that transaction hash,
 * so the only thing the wallet ever signs against this contract is the user
 * taking their own money out.
 *
 * The one rule that survives from the old design: a revert is decoded into the
 * contract's own custom error before it reaches the user, since "execution
 * reverted" tells nobody whether they hit the wallet limit or asked to withdraw
 * a balance that is already zero.
 */

import {
  createPublicClient,
  decodeErrorResult,
  encodeFunctionData,
  http,
  parseEventLogs,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import {FACTORY_ADDRESS, RPC_URL, robinhoodChain} from "@/lib/chain";
import {FACTORY_ABI} from "@/lib/abi";
import {walletErrorMessage} from "@/lib/wallet";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** True when the build has a real factory address compiled in. */
export function factoryConfigured(): boolean {
  return FACTORY_ADDRESS.toLowerCase() !== ZERO_ADDRESS;
}

// One client per tab. `http()` holds no socket, so this is only about not
// re-parsing the chain config on every read.
let client: PublicClient | null = null;

function publicClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: robinhoodChain,
      transport: http(RPC_URL),
    }) as PublicClient;
  }
  return client;
}

/* -------------------------------------------------------------------- reads */

export type FactoryConfig = {
  /** Nodes one wallet may hold. `mintFor` reverts with WalletLimit past this. */
  maxPerWallet: number;
  paused: boolean;
};

/**
 * The two contract values the deploy flow has to respect. The price is NOT
 * among them: it lives off chain (NODE_PRICE_WEI) because the contract never
 * sees the payment, so quoting it is the server's job, not this module's.
 *
 * Read as one batch so both values describe the same block.
 */
export async function readFactoryConfig(): Promise<FactoryConfig> {
  const rpc = publicClient();
  const base = {address: FACTORY_ADDRESS, abi: FACTORY_ABI} as const;

  const [maxPerWallet, paused] = await Promise.all([
    rpc.readContract({...base, functionName: "maxPerWallet"}),
    rpc.readContract({...base, functionName: "paused"}),
  ]);

  return {maxPerWallet: Number(maxPerWallet), paused};
}

/** Everything the contract stores about one node. */
export type NodeChainInfo = {
  /** Lowercased, or null for an id the contract has never minted. */
  owner: `0x${string}` | null;
  /** Unix seconds. Zero for an id the contract has never minted. */
  createdAt: bigint;
  /** Withdrawable right now. */
  balanceWei: bigint;
  /** Credited over the node's whole life. */
  totalReceivedWei: bigint;
  /** Paid out over the node's whole life. */
  totalWithdrawnWei: bigint;
};

/**
 * One node's figures, straight out of contract storage.
 *
 * This mirrors `nodeInfo` in lib/rpc.ts, which is the server's copy of the same
 * read. Two modules exist because the server one is built on lib/env.ts and
 * cannot be imported into a bundle; the shape is deliberately identical so the
 * dashboard and the API can never disagree about what a field means.
 *
 * The dashboard reads all three money figures from here rather than from the
 * ledger. A balance is contract state by definition, and total received and
 * total withdrawn arrive in the same call, so taking the balance from the chain
 * and the totals from Postgres would only buy a row that contradicts itself.
 */
export async function readNodeInfo(nodeId: bigint): Promise<NodeChainInfo> {
  const [owner, createdAt, balance, totalReceived, totalWithdrawn] = await publicClient()
    .readContract({
      address: FACTORY_ADDRESS,
      abi: FACTORY_ABI,
      functionName: "nodeInfo",
      args: [nodeId],
    });

  return {
    // An id that was never minted comes back as the zero address rather than a
    // revert, so that is the only "does not exist" signal there is.
    owner: owner.toLowerCase() === ZERO_ADDRESS ? null : (owner.toLowerCase() as `0x${string}`),
    createdAt,
    balanceWei: balance,
    totalReceivedWei: totalReceived,
    totalWithdrawnWei: totalWithdrawn,
  };
}

/** Withdrawable balance the contract currently holds for one node. */
export async function readNodeBalance(nodeId: bigint): Promise<bigint> {
  return (await readNodeInfo(nodeId)).balanceWei;
}

/** Combined withdrawable balance across every node a wallet owns. */
export function readOwnerBalance(owner: `0x${string}`): Promise<bigint> {
  return publicClient().readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "balanceOfOwner",
    args: [owner],
  });
}

/* ------------------------------------------------------------------ encoding */

/**
 * Empty one node into `to`.
 *
 * There is no amount: the contract sends the whole balance or reverts. That is
 * deliberate on the contract side, so the UI must not offer a partial figure
 * and then encode something the chain will ignore.
 */
export function encodeWithdraw(args: {nodeId: bigint; to: `0x${string}`}): `0x${string}` {
  return encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "withdraw",
    args: [args.nodeId, args.to],
  });
}

/**
 * Sweep every node the sender owns in one transaction. Bounded by
 * `maxPerWallet` on the contract, which is why that cap exists at all.
 */
export function encodeWithdrawAll(args: {to: `0x${string}`}): `0x${string}` {
  return encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "withdrawAll",
    args: [args.to],
  });
}

/* ------------------------------------------------------------------ receipts */

/**
 * Wait for a transaction the wallet already broadcast. Reverts are surfaced as
 * an error here rather than returning a failed receipt, so callers have one
 * failure path.
 */
export async function waitForReceipt(hash: `0x${string}`): Promise<TransactionReceipt> {
  const receipt = await publicClient().waitForTransactionReceipt({
    hash,
    // Robinhood Chain blocks are fast; a longer poll only delays the UI.
    pollingInterval: 1_000,
    timeout: 180_000,
  });
  if (receipt.status !== "success") {
    throw new Error("The transaction failed on chain. Nothing was charged beyond the network fee.");
  }
  return receipt;
}

/**
 * The node id from a mint receipt. Logs are filtered to the factory address so
 * an unrelated contract in the same transaction cannot supply the id.
 */
export function nodeIdFromReceipt(receipt: TransactionReceipt): bigint | null {
  const logs = parseEventLogs({
    abi: FACTORY_ABI,
    eventName: "NodeMinted",
    logs: receipt.logs,
  });
  for (const log of logs) {
    if (log.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase()) return log.args.id;
  }
  return null;
}

/** Every Withdrawn event this receipt carries, filtered to the factory. */
export function withdrawalsFromReceipt(
  receipt: TransactionReceipt,
): Array<{nodeId: bigint; to: `0x${string}`; amountWei: bigint}> {
  const logs = parseEventLogs({
    abi: FACTORY_ABI,
    eventName: "Withdrawn",
    logs: receipt.logs,
  });
  return logs
    .filter((log) => log.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase())
    .map((log) => ({
      nodeId: log.args.id,
      to: log.args.to.toLowerCase() as `0x${string}`,
      amountWei: log.args.amount,
    }));
}

/* -------------------------------------------------------------------- errors */

/**
 * Every custom error in the ABI, phrased for someone who is not reading
 * Solidity. The list is exhaustive on purpose: an error with no entry here
 * falls through to the generic wallet message, which loses the one fact the
 * chain actually told us.
 */
const ERROR_TEXT: Record<string, string> = {
  // Access control. A user can only ever trip NotNodeOwner; the rest mean the
  // operator's own wallets are misconfigured, so they say so plainly.
  NotOwner: "That action is restricted to the contract owner.",
  NotRelayer: "Nodes can only be created by the operator's relayer wallet.",
  NotDistributor: "Rewards can only be credited by the operator's distributor wallet.",
  NotNodeOwner: "This node is not held by the connected wallet.",
  NotPendingOwner: "Only the nominated owner can accept ownership.",

  // Mint path.
  WalletLimit: "This wallet already holds the maximum number of nodes.",
  IsPaused: "Deploys are paused right now. Try again later.",
  RefAlreadyUsed: "A node has already been created for that payment.",

  // Withdraw path.
  NothingToWithdraw: "There is nothing to withdraw. This balance is already empty.",
  TransferFailed: "The transfer failed on chain. Nothing was moved.",

  // Credit path. These are operator-side accounting failures.
  ValueMismatch: "The credited amounts do not match the ETH sent with them.",
  AmountTooLarge: "That credit amount is larger than a node balance can hold.",
  ExceedsFree: "That is more than the unattached balance. Node balances cannot be touched.",

  // Generic guards.
  BadInput: "That request is not valid. Check the address and try again.",
  Reentrancy: "The contract rejected a re-entrant call. Nothing was moved.",
};

/** Depth-first search for the revert payload; wallets nest it differently. */
function revertData(err: unknown): `0x${string}` | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];

  while (queue.length > 0) {
    const node = queue.shift();
    if (typeof node !== "object" || node === null || seen.has(node)) continue;
    seen.add(node);

    const record = node as Record<string, unknown>;
    const data = record.data;
    if (typeof data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(data)) {
      return data as `0x${string}`;
    }
    // MetaMask puts it one level down under `data.originalError.data`.
    for (const key of ["data", "cause", "error", "originalError", "info", "details"]) {
      if (record[key] !== undefined) queue.push(record[key]);
    }
  }
  return null;
}

/**
 * Turn any failure from a factory call into one sentence. Falls back to the
 * wallet-level message, which already covers rejection and pending requests.
 */
export function describeFactoryError(err: unknown): string {
  const data = revertData(err);
  if (data) {
    try {
      const decoded = decodeErrorResult({abi: FACTORY_ABI, data});
      const text = ERROR_TEXT[decoded.errorName];
      if (text) return text;
    } catch {
      // Not one of ours: fall through to the wallet message.
    }
  }
  return walletErrorMessage(err);
}
