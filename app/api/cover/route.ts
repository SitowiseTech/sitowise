/**
 * GET /api/cover  ->  { contract, balanceWei, outstandingWei, covered, paused }
 *
 * Whether the money owed to node holders is actually sitting in the contract.
 *
 * Unlike /api/stats this reads the chain rather than the ledger, deliberately.
 * The whole point of the figure is that it does not depend on our database
 * being honest: a holder comparing these two numbers is reading the same
 * storage slots they would read themselves on Blockscout.
 */

import {checkLimit, jsonError, jsonOk, mergeHeaders, publicCache, toResponse} from "@/lib/api";
import {readCover} from "@/lib/onchain";

export type CoverResponse = {
  contract: `0x${string}`;
  balanceWei: string;
  outstandingWei: string;
  covered: boolean;
  paused: boolean;
};

const CACHE_SECONDS = 15;

// Four RPC reads per call, and every dashboard visit asks. The numbers move
// on the scale of a credit round, not of a request.
let memo: {at: number; value: CoverResponse} | null = null;

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "cover", {limit: 120});
  if (limit.blocked) return limit.blocked;

  try {
    const now = Date.now();
    if (memo && now - memo.at < CACHE_SECONDS * 1000) {
      return jsonOk(memo.value, mergeHeaders(limit.headers, publicCache(CACHE_SECONDS)));
    }

    const read = await readCover();
    if (!read.ok) {
      // Never serve a stale "covered" through an RPC outage. A holder reading
      // this is asking whether their money is there right now, and a cached
      // yes is exactly the answer that must not survive losing the chain.
      memo = null;
      return jsonError("The chain could not be read.", 503, limit.headers);
    }

    const {address, balanceWei, outstandingWei, isSolvent, paused} = read.data;
    const value: CoverResponse = {
      contract: address,
      balanceWei: balanceWei.toString(),
      outstandingWei: outstandingWei.toString(),
      covered: isSolvent,
      paused,
    };

    memo = {at: now, value};
    return jsonOk(value, mergeHeaders(limit.headers, publicCache(CACHE_SECONDS)));
  } catch (err) {
    return toResponse(err, "cover", limit.headers);
  }
}
