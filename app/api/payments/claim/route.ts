/**
 * POST /api/payments/claim  { txHash }  ->  { status, tier }
 *
 * A buyer telling us about their own payment.
 *
 * Discovery has always been a scan: watch the payments wallet and notice
 * transfers arriving. That works until the thing being watched with stops
 * working, and when Blockscout put its API behind a bot challenge the scan went
 * blind for forty hours. People paid and got nothing, and the only reason we
 * learned about it was that some of them wrote in with their transaction hash.
 *
 * They should not have to. The browser that sent the payment already has the
 * hash a second after signing, which is sooner than any scan could find it and
 * without depending on anything but our own RPC.
 *
 * Nothing is trusted here. The hash is only a pointer: every fact that matters
 * is re-read from the chain, exactly as it is for a discovered payment, and a
 * hash that is not a real transfer of a tier price to the payments wallet is
 * refused. Claiming somebody else's payment achieves nothing either, because
 * the node is minted to the address the ETH came from, never to the caller.
 *
 * Public and unauthenticated, because the payment happens before any wallet
 * session exists. Rate limited, and idempotent: a repeat is a no-op.
 */

import {checkLimit, jsonError, jsonOk, mergeHeaders, PRIVATE_CACHE, readJsonBody, toResponse} from "@/lib/api";
import {adoptPayment} from "@/lib/watcher";
import {readPaymentByHash} from "@/lib/payments";

export async function POST(req: Request): Promise<Response> {
  // Generous enough for a retry loop after a slow receipt, tight enough that
  // the route cannot be used to hammer the RPC.
  const limit = checkLimit(req, "payment-claim", {limit: 30});
  if (limit.blocked) return limit.blocked;

  try {
    const body = await readJsonBody(req);
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return jsonError("Send the payment transaction hash.", 400, limit.headers);
    }

    // Already known: say so and stop. The scan may have found it first, and
    // this is the ordinary race rather than a problem.
    const existing = await readPaymentByHash(txHash);
    if (existing) {
      return jsonOk(
        {
          status: existing.status,
          tier: existing.tier,
          nodeChainId: existing.node_chain_id,
          from: existing.from_address,
          amountWei: existing.amount_wei,
          // The parked reason, which is the whole point of showing this to a
          // buyer: "held for review" without saying why is what sends somebody
          // to our messages instead of to the answer.
          reason: existing.status === "manual_review" ? existing.last_error : null,
          known: true,
        },
        mergeHeaders(limit.headers, PRIVATE_CACHE),
      );
    }

    const adopted = await adoptPayment(txHash as `0x${string}`);
    if (!adopted.ok) {
      // "Not yet visible" is the common case for a hash sent the instant it was
      // broadcast, and it is worth retrying rather than an error to show.
      return jsonError(adopted.reason, 409, limit.headers);
    }

    // Just adopted, so it is queued rather than minted. Re-read so the answer
    // carries the tier and the parked reason the decision produced.
    const row = await readPaymentByHash(txHash);
    return jsonOk(
      {
        status: row?.status ?? adopted.status,
        tier: row?.tier ?? null,
        nodeChainId: row?.node_chain_id ?? null,
        from: row?.from_address ?? adopted.from,
        amountWei: row?.amount_wei ?? adopted.amountWei,
        reason: row?.status === "manual_review" ? row.last_error : null,
        known: false,
      },
      mergeHeaders(limit.headers, PRIVATE_CACHE),
    );
  } catch (err) {
    return toResponse(err, "payment-claim", limit.headers);
  }
}
