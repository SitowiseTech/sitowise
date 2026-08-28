/**
 * GET /api/deploy-quote[?address=0x…]
 *   -> { paymentAddress, chainId, priceWei, tiers[] }
 *
 * What the deploy flow has to know before it can ask a wallet for money, and
 * none of it is readable from the browser.
 *
 * Buying a node is a plain ETH transfer to the payments wallet: the contract
 * never sees the payment, so it has no `price()` to read and no address to
 * point at. A price literal in the component would keep quoting the old figure
 * after a change, and every transfer sent against it would land in manual
 * review.
 *
 * With `address`, the answer also says what that wallet may actually buy right
 * now: how much SITOWISE it holds, which gated tiers that unlocks, and how much
 * of each tier's allowance it has left. Working that out in the browser would
 * mean shipping the thresholds and the allowance arithmetic to the client and
 * trusting the answer, and the pipeline would still have to redo all of it.
 *
 * Public and unauthenticated: it is the same information the landing page
 * prints, and a wallet needs it before it has signed anything.
 */

import {checkLimit, jsonOk, mergeHeaders, publicCache, PRIVATE_CACHE, toResponse} from "@/lib/api";
import {isAddress} from "viem";
import {paymentAddress, publicChainId} from "@/lib/env";
import {
  holdingOf,
  loadTiers,
  tierCountsFor,
  tierUsageFor,
  TIER_IDS,
  type TierId,
} from "@/lib/tiers";

export type QuotedTier = {
  id: TierId;
  label: string;
  priceWei: string;
  maxPerWallet: number;
  /** SITOWISE needed to buy it. "0" means open to anyone. */
  holdingWei: string;
  payoutBps: number;
  onSale: boolean;
  /** Present only when an address was given. */
  held?: number;
  remaining?: number;
  eligible?: boolean;
  /** Why not, in words the buyer can act on. */
  blockedReason?: string;
};

export type DeployQuoteResponse = {
  paymentAddress: string;
  chainId: number;
  /** The base tier price, kept so older clients keep working. */
  priceWei: string;
  tiers: QuotedTier[];
  /** Present only when an address was given and the token is published. */
  holdingWei?: string;
};

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "deploy-quote", {limit: 60});
  if (limit.blocked) return limit.blocked;

  try {
    const raw = new URL(req.url).searchParams.get("address");
    const address = raw && isAddress(raw) ? (raw.toLowerCase() as `0x${string}`) : null;

    const {tiers} = await loadTiers();
    const base: DeployQuoteResponse = {
      paymentAddress: paymentAddress(),
      chainId: publicChainId(),
      priceWei: tiers.base.priceWei.toString(),
      tiers: TIER_IDS.map((id) => ({
        id,
        label: tiers[id].label,
        priceWei: tiers[id].priceWei.toString(),
        maxPerWallet: tiers[id].maxPerWallet,
        holdingWei: tiers[id].holdingWei.toString(),
        payoutBps: tiers[id].payoutBps,
        onSale: tiers[id].onSale,
      })),
    };

    if (!address) {
      // Short cache: a price change should reach open tabs in seconds, and this
      // is the number a user is about to send money against.
      return jsonOk(base, mergeHeaders(limit.headers, publicCache(30)));
    }

    const gated = TIER_IDS.some((id) => tiers[id].holdingWei > 0n);
    const holding = gated ? await holdingOf(address) : null;
    // `held` is what the wallet actually owns, for display. `used` is what has
    // been spent against the allowance, which also counts payments still on
    // their way to becoming nodes.
    const [held, used] = await Promise.all([tierCountsFor(address), tierUsageFor(address)]);

    base.tiers = base.tiers.map((tier) => {
      const spec = tiers[tier.id];
      const remaining = Math.max(spec.maxPerWallet - used[tier.id], 0);

      let eligible = true;
      let blockedReason: string | undefined;

      if (!spec.onSale) {
        eligible = false;
        blockedReason = "This tier is closed to new purchases.";
      } else if (spec.holdingWei > 0n) {
        if (!holding || !holding.ok) {
          eligible = false;
          blockedReason = holding?.reason ?? "The token balance could not be read.";
        } else if (holding.balanceWei < spec.holdingWei) {
          eligible = false;
          blockedReason = "Holds less SITOWISE than this tier requires.";
        }
      }

      if (eligible && remaining === 0) {
        eligible = false;
        blockedReason = "This wallet is at the allowance for this tier.";
      }

      return {...tier, held: held[tier.id], remaining, eligible, blockedReason};
    });

    if (holding?.ok) base.holdingWei = holding.balanceWei.toString();

    // Never cached: it is about one wallet, and it changes the moment that
    // wallet buys or moves tokens.
    return jsonOk(base, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    // A missing PAYMENT_ADDRESS answers 503 rather than quoting a zero address
    // that would swallow the payment.
    return toResponse(err, "deploy-quote", limit.headers);
  }
}
