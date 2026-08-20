/**
 * GET /api/deploy-quote -> { priceWei, paymentAddress, chainId }
 *
 * What the deploy flow has to know before it can ask a wallet for money, and
 * neither half of it is readable from the browser.
 *
 * Buying a node is a plain ETH transfer to the payments wallet: the contract
 * never sees the payment, so it has no `price()` to read and no address to
 * point at. Both live in the server's environment (NODE_PRICE_WEI,
 * PAYMENT_ADDRESS), which makes this route the only honest source for them. A
 * price literal in the component would keep quoting the old figure after a
 * change, and every transfer sent against it would land in manual review.
 *
 * Public and unauthenticated on purpose: it is the same information the landing
 * page prints, and a wallet needs it before it has signed anything.
 */

import {checkLimit, jsonOk, mergeHeaders, publicCache, toResponse} from "@/lib/api";
import {nodePriceWei, paymentAddress, publicChainId} from "@/lib/env";

export type DeployQuoteResponse = {
  /** Exact wei a transfer must carry. Decimal string; never a float. */
  priceWei: string;
  /** Wallet the transfer must be sent to. */
  paymentAddress: string;
  chainId: number;
};

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "deploy-quote", {limit: 60});
  if (limit.blocked) return limit.blocked;

  try {
    const body: DeployQuoteResponse = {
      priceWei: nodePriceWei().toString(),
      paymentAddress: paymentAddress(),
      chainId: publicChainId(),
    };

    // Short cache: a price change should reach open tabs in seconds, and this
    // is the number a user is about to send money against.
    return jsonOk(body, mergeHeaders(limit.headers, publicCache(30)));
  } catch (err) {
    // A missing PAYMENT_ADDRESS answers 503 rather than quoting a zero address
    // that would swallow the payment.
    return toResponse(err, "deploy-quote", limit.headers);
  }
}
