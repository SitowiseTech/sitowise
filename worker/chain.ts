/**
 * The worker's chain primitives.
 *
 * The distributor account is the only part of Sitowise that sends a
 * transaction on its own behalf. It calls `creditBatch` payable, which means it
 * carries the ETH being paid out: this module holds the key and nothing else
 * does. Reads that /admin also needs live in lib/onchain.ts.
 *
 * The loop that decides what to credit, and when, is not here. This file only
 * answers "can we credit", "credit this", and "how much gas and float is left".
 */

import {createWalletClient, http, type Hash, type PrivateKeyAccount} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {FACTORY_ABI} from "@/lib/abi";
import {robinhoodChain, RPC_URL} from "@/lib/chain";
import {distributorPrivateKey, EnvError, factoryAddress} from "@/lib/env";
import {publicClient} from "@/lib/onchain";

/** Long enough for a slow block, short enough that a tick cannot hang forever. */
const RECEIPT_TIMEOUT_MS = 120_000;

let cachedAccount: PrivateKeyAccount | null = null;

/**
 * The distributor account, or null when DISTRIBUTOR_PRIVATE_KEY is not set.
 *
 * Null rather than a throw, because the worker has to be able to start, report
 * "not configured" and keep its health endpoint honest instead of crash-looping
 * on a missing variable.
 */
export function distributorAccount(): PrivateKeyAccount | null {
  if (cachedAccount) return cachedAccount;
  try {
    cachedAccount = privateKeyToAccount(distributorPrivateKey());
  } catch (err) {
    if (err instanceof EnvError) return null;
    throw err;
  }
  return cachedAccount;
}

function requireAccount(): PrivateKeyAccount {
  const account = distributorAccount();
  if (!account) throw new Error("DISTRIBUTOR_PRIVATE_KEY is not set");
  return account;
}

function walletFor(account: PrivateKeyAccount) {
  return createWalletClient({account, chain: robinhoodChain, transport: http(RPC_URL)});
}

/* ------------------------------------------------------------------- reads */

/**
 * ETH the distributor holds.
 *
 * This is both the gas budget and the payout float, because `creditBatch` sends
 * the credited value with the call. A tick that ignores this credits nodes with
 * money the account does not have and reverts on ValueMismatch's sibling: the
 * transaction simply fails for insufficient funds.
 */
export async function distributorBalance(): Promise<bigint> {
  const account = distributorAccount();
  if (!account) return 0n;
  return publicClient().getBalance({address: account.address});
}

/** The factory's pause flag. Credits are pointless while deploys are stopped. */
export function factoryPaused(): Promise<boolean> {
  return publicClient().readContract({
    address: factoryAddress(),
    abi: FACTORY_ABI,
    functionName: "paused",
  });
}

/* --------------------------------------------------------------- readiness */

export type DistributorCheck =
  | {ok: true; address: `0x${string}`; balanceWei: bigint}
  | {ok: false; reason: string};

/**
 * Confirm the worker can actually credit before the loop starts scheduling.
 *
 * `creditBatch` is restricted to the address the contract stores as
 * `distributor`, so a key that is anything else would fail once per tick
 * forever. Comparing against the on-chain value catches a rotated role, which a
 * balance check alone would not.
 */
export async function checkDistributor(onChainDistributor: `0x${string}`): Promise<DistributorCheck> {
  const account = distributorAccount();
  if (!account) return {ok: false, reason: "DISTRIBUTOR_PRIVATE_KEY is not set"};

  const address = account.address.toLowerCase() as `0x${string}`;
  if (address !== onChainDistributor.toLowerCase()) {
    return {
      ok: false,
      reason: `${address} is not the factory's distributor (${onChainDistributor.toLowerCase()})`,
    };
  }

  return {ok: true, address, balanceWei: await publicClient().getBalance({address})};
}

/* ------------------------------------------------------------------ writes */

export type CreditEntry = {chainNodeId: bigint; amountWei: bigint};

/**
 * Put ETH on node balances. The value sent equals the sum of the amounts,
 * because the contract requires exactly that: a batch whose `msg.value` is off
 * by a wei reverts with ValueMismatch rather than crediting a partially backed
 * balance.
 *
 * Returns null for an empty batch, which is a normal tick with nothing due,
 * not an error.
 */
export async function creditBatch(entries: CreditEntry[]): Promise<Hash | null> {
  if (entries.length === 0) return null;

  const account = requireAccount();
  const ids = entries.map((entry) => entry.chainNodeId);
  const amounts = entries.map((entry) => entry.amountWei);
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);

  // A zero amount reverts the whole batch on BadInput, so it is worth catching
  // here where the caller can see which node produced it.
  if (amounts.some((amount) => amount <= 0n)) {
    throw new Error("creditBatch was given an amount of zero or less");
  }

  const client = publicClient();

  // Simulate first: a revert here costs nothing, while a sent transaction that
  // reverts costs gas and leaves the schedule believing it has paid.
  const {request} = await client.simulateContract({
    account,
    address: factoryAddress(),
    abi: FACTORY_ABI,
    functionName: "creditBatch",
    args: [ids, amounts],
    value: total,
  });

  const hash = await walletFor(account).writeContract(request);
  const receipt = await client.waitForTransactionReceipt({hash, timeout: RECEIPT_TIMEOUT_MS});
  if (receipt.status !== "success") {
    throw new Error(`creditBatch ${hash} from ${account.address} reverted on chain`);
  }
  return hash;
}

/** Current head, for anything that needs to record where it read up to. */
export function headBlock(): Promise<bigint> {
  return publicClient().getBlockNumber();
}
