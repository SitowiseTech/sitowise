/**
 * GET /api/tiers  ->  { tiers[] }
 *
 * What a node costs and what the price buys, without asking about a wallet.
 *
 * The same figures reach the deploy flow through /api/deploy-quote, but that
 * route answers for one buyer: it needs an address, it reads a token balance,
 * and it is deliberately uncached. This one is the public shape of the product,
 * cacheable and the same for everyone, which is what an integration or a
 * dashboard actually wants.
 *
 * `enforcedBy` is on every rule on purpose. Only the total nodes per wallet is
 * in the contract; the per-tier allowance and the holding threshold are applied
 * by us before minting. An API that presented them as one kind of guarantee
 * would be the most convincing place to get that wrong.
 */

import {checkLimit, jsonOk, mergeHeaders, publicCache, toResponse} from "@/lib/api";
import {loadTiers, TIER_IDS} from "@/lib/tiers";
import {readTokenCa} from "@/lib/token";

export type TierResponse = {
  id: string;
  label: string;
  /** Exact wei a transfer must carry to buy this tier. */
  priceWei: string;
  /** How many of this tier one wallet may hold. */
  maxPerWallet: number;
  /** Token that must be held, and how much. Zero means open to anyone. */
  holdingWei: string;
  holdingToken: string | null;
  /** Accrual against the base per-credit range. 10000 is the base rate. */
  payoutBps: number;
  onSale: boolean;
  enforcedBy: {
    price: "contract" | "operator";
    maxPerWallet: "contract" | "operator";
    holding: "contract" | "operator";
  };
};

const CACHE_SECONDS = 30;

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "tiers", {limit: 120});
  if (limit.blocked) return limit.blocked;

  try {
    const [{tiers}, token] = await Promise.all([loadTiers(), readTokenCa()]);

    const body = {
      tiers: TIER_IDS.map<TierResponse>((id) => ({
        id,
        label: tiers[id].label,
        priceWei: tiers[id].priceWei.toString(),
        maxPerWallet: tiers[id].maxPerWallet,
        holdingWei: tiers[id].holdingWei.toString(),
        holdingToken: tiers[id].holdingWei > 0n ? token : null,
        payoutBps: tiers[id].payoutBps,
        onSale: tiers[id].onSale,
        enforcedBy: {
          // The amount is checked against the chain before anything is minted,
          // but the price itself is ours: the contract never sees the payment.
          price: "operator",
          maxPerWallet: "operator",
          holding: "operator",
        },
      })),
    };

    return jsonOk(body, mergeHeaders(limit.headers, publicCache(CACHE_SECONDS)));
  } catch (err) {
    return toResponse(err, "tiers", limit.headers);
  }
}
