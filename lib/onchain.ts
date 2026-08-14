/**
 * Server-side reads of Robinhood Chain.
 *
 * Anything that renders live contract state goes through here so there is one
 * client, one place that knows the RPC can be down, and one shape for the
 * failure. Reads never throw at the caller: /admin has to be able to say "RPC
 * unreachable" while still showing everything the database knows.
 *
 * Server only. The browser talks to the chain through the user's wallet.
 */

import {createPublicClient, http, type PublicClient} from "viem";
import {FACTORY_ABI} from "@/lib/abi";
import {robinhoodChain, RPC_URL} from "@/lib/chain";
import {factoryAddress} from "@/lib/env";

// Cached on globalThis so dev hot reloads do not pile up clients and their
// keep-alive sockets. The key is deliberately NOT the one lib/rpc.ts uses: that
// module builds a patient client (15s, two retries) for the mint and credit
// money paths, this one a fail-fast client so /admin can render "RPC unreachable"
// instead of hanging. Sharing a key made whichever module loaded first silently
// impose its timeout policy on the other.
const globalForClient = globalThis as unknown as {__sitowiseReadRpc?: PublicClient};

export function publicClient(): PublicClient {
  if (globalForClient.__sitowiseReadRpc) return globalForClient.__sitowiseReadRpc;
  const client = createPublicClient({
    chain: robinhoodChain,
    // One retry: a page render should fail fast and say so rather than hang.
    transport: http(RPC_URL, {retryCount: 1, timeout: 8_000}),
  });
  globalForClient.__sitowiseReadRpc = client;
  return client;
}

export type FactorySnapshot = {
  address: `0x${string}`;
  /** ETH the contract actually holds, from the node rather than from storage. */
  balanceWei: bigint;

  // Roles. Read so /admin can prove the relayer and distributor keys it is
  // configured with are the ones the contract will accept, instead of finding
  // out one reverted transaction at a time.
  owner: `0x${string}`;
  relayer: `0x${string}`;
  distributor: `0x${string}`;

  /** Nodes one wallet may hold, and the hard ceiling the owner cannot raise past. */
  maxPerWallet: bigint;
  maxPerWalletCeiling: bigint;
  paused: boolean;

  totalNodes: bigint;
  /** Everything ever credited to node balances. */
  totalDistributedWei: bigint;
  /** Everything ever withdrawn out of them. */
  totalWithdrawnWei: bigint;
  /**
   * Sum of every live node balance. This is the holders' guarantee: `rescue`
   * can never reach below it, so it is the number /admin exists to watch.
   */
  outstandingWei: bigint;
  /** Balance attached to no node, which is all the owner may ever rescue. */
  freeBalanceWei: bigint;
  /** balance >= outstanding. False means node balances are not fully backed. */
  isSolvent: boolean;
};

export type ChainRead<T> = {ok: true; data: T} | {ok: false; error: string};

function failure(err: unknown): {ok: false; error: string} {
  const message = err instanceof Error ? err.message : String(err);
  // viem messages carry the whole request; the first line is the useful part.
  return {ok: false, error: message.split("\n")[0]};
}

/** Everything /admin needs from the factory, in one round of reads. */
export async function readFactory(): Promise<ChainRead<FactorySnapshot>> {
  let address: `0x${string}`;
  try {
    address = factoryAddress();
  } catch (err) {
    return failure(err);
  }

  const client = publicClient();
  const contract = {address, abi: FACTORY_ABI} as const;

  try {
    // One Promise.all so every figure below comes from the same moment. Solvency
    // compared across two blocks would be a rumour, not a check.
    const [
      balanceWei,
      owner,
      relayer,
      distributor,
      maxPerWallet,
      maxPerWalletCeiling,
      paused,
      totalNodes,
      totalDistributedWei,
      totalWithdrawnWei,
      outstandingWei,
      freeBalanceWei,
      isSolvent,
    ] = await Promise.all([
      client.getBalance({address}),
      client.readContract({...contract, functionName: "owner"}),
      client.readContract({...contract, functionName: "relayer"}),
      client.readContract({...contract, functionName: "distributor"}),
      client.readContract({...contract, functionName: "maxPerWallet"}),
      client.readContract({...contract, functionName: "MAX_PER_WALLET_CEILING"}),
      client.readContract({...contract, functionName: "paused"}),
      client.readContract({...contract, functionName: "totalNodes"}),
      client.readContract({...contract, functionName: "totalDistributed"}),
      client.readContract({...contract, functionName: "totalWithdrawn"}),
      client.readContract({...contract, functionName: "outstanding"}),
      client.readContract({...contract, functionName: "freeBalance"}),
      client.readContract({...contract, functionName: "isSolvent"}),
    ]);

    return {
      ok: true,
      data: {
        address,
        balanceWei,
        owner,
        relayer,
        distributor,
        maxPerWallet,
        maxPerWalletCeiling,
        paused,
        totalNodes,
        totalDistributedWei,
        totalWithdrawnWei,
        outstandingWei,
        freeBalanceWei,
        isSolvent,
      },
    };
  } catch (err) {
    return failure(err);
  }
}

/** Native balance of any address. Used for the payments-wallet row in /admin. */
export async function readBalance(address: `0x${string}`): Promise<ChainRead<bigint>> {
  try {
    return {ok: true, data: await publicClient().getBalance({address})};
  } catch (err) {
    return failure(err);
  }
}
