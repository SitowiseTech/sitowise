/**
 * GET  /api/admin/payments                  -> payments that still owe a node
 * POST /api/admin/payments  { txHash }      -> put one back in the minting queue
 *
 * The console could always count parked payments and never do anything about
 * one. That gap showed up with real money: a relayer ran out of gas, every
 * mint attempt for four paid-for nodes failed, the rows spent their retry
 * budget and parked, and the only way to recover them was the database.
 *
 * Requeuing is safe against double minting because the contract refuses a
 * second mint against the same payment hash. See `requeuePayment`.
 */

import {
  checkLimit,
  jsonError,
  jsonOk,
  mergeHeaders,
  PRIVATE_CACHE,
  readJsonBody,
  requireAdmin,
  toResponse,
} from "@/lib/api";
import {
  markRefunded,
  readPaymentByHash,
  readPaymentsFrom,
  readParkedPayments,
  requeuePayment,
} from "@/lib/payments";
import {adoptPayment, decide, readPaymentFacts} from "@/lib/watcher";
import {loadTiers} from "@/lib/tiers";
import {paymentAddress} from "@/lib/env";

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "admin-payments", {limit: 30});
  if (limit.blocked) return limit.blocked;

  try {
    requireAdmin(req);
    // ?from=0x… shows every row for one wallet whatever its status, which is
    // what you need when the question is "why does this buyer not have a node"
    // and the answer might be that the payment was never recorded at all.
    const from = new URL(req.url).searchParams.get("from");
    const rows = from ? await readPaymentsFrom(from) : await readParkedPayments();
    return jsonOk(
      {
        payments: rows.map((row) => ({
          txHash: row.tx_hash,
          from: row.from_address,
          amountWei: row.amount_wei,
          blockNumber: row.block_number,
          status: row.status,
          tier: row.tier,
          attempts: row.attempts,
          lastError: row.last_error,
          createdAt: row.created_at,
        })),
      },
      mergeHeaders(limit.headers, PRIVATE_CACHE),
    );
  } catch (err) {
    return toResponse(err, "admin-payments", limit.headers);
  }
}

export async function POST(req: Request): Promise<Response> {
  const limit = checkLimit(req, "admin-payments-write", {limit: 30});
  if (limit.blocked) return limit.blocked;

  try {
    requireAdmin(req);
    const body = await readJsonBody(req);
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return jsonError("Pass the payment transaction hash.", 400, limit.headers);
    }

    // action: "refund" records money that was received and paid back. It is
    // terminal, and it writes the row even when discovery never saw the
    // payment, which is exactly the case that could otherwise be backfilled
    // into a free node later.
    if (body.action === "refund") {
      const note = typeof body.note === "string" && body.note.trim() !== ""
        ? body.note.trim().slice(0, 400)
        : "refunded off chain";

      const facts = await readPaymentFacts(txHash as `0x${string}`);
      if (!facts.ok) return jsonError(facts.reason, 400, limit.headers);
      if (!facts.toPayments) {
        return jsonError("That transaction was not sent to the payments wallet.", 400, limit.headers);
      }

      const result = await markRefunded({
        txHash,
        from: facts.from,
        amountWei: facts.amountWei,
        blockNumber: facts.blockNumber,
        note,
      });

      if (result.status === "already-minted") {
        return jsonError(
          "That payment already produced a node, so it cannot be marked refunded.",
          409,
          limit.headers,
        );
      }

      return jsonOk(
        {
          txHash,
          from: facts.from,
          amountWei: facts.amountWei.toString(),
          status: "refunded",
          recorded: result.status,
        },
        mergeHeaders(limit.headers, PRIVATE_CACHE),
      );
    }

    // Re-decide from the chain and the current tier settings, rather than
    // trusting the verdict this payment was parked with. A price that matched
    // no tier last week can be a tier price today.
    const facts = await readPaymentFacts(txHash as `0x${string}`);
    if (!facts.ok) return jsonError(facts.reason, 400, limit.headers);
    if (!facts.toPayments) {
      return jsonError("That transaction was not sent to the payments wallet.", 400, limit.headers);
    }

    const {tiers} = await loadTiers();
    const verdict = await decide(facts.amountWei, facts.from, paymentAddress(), tiers);

    const row = await requeuePayment(txHash, verdict);
    if (!row) {
      // Not parked. Either it is already minted, or discovery never recorded it
      // at all, which is the case a cursor that stepped over a block leaves
      // behind. Adoption re-reads the transaction from the chain and records it
      // if it really is a payment, so the second case is recoverable here
      // instead of needing a day of cursor rewound.
      // A row that exists but is not requeueable is terminal: minted, or
      // refunded. Adoption would insert nothing (the hash is unique) and then
      // report the verdict it computed, which reads as success and is a lie.
      // Refuse here and say what the payment actually is.
      const existing = await readPaymentByHash(txHash);
      if (existing) {
        return jsonError(
          `That payment is already recorded as ${existing.status} and will not be requeued.`,
          409,
          limit.headers,
        );
      }

      const adopted = await adoptPayment(txHash as `0x${string}`);
      if (adopted.ok) {
        return jsonOk(
          {txHash, from: adopted.from, status: adopted.status, adopted: true},
          mergeHeaders(limit.headers, PRIVATE_CACHE),
        );
      }
      return jsonError(
        `Nothing to requeue, and it could not be adopted: ${adopted.reason}`,
        404,
        limit.headers,
      );
    }

    return jsonOk(
      {txHash: row.tx_hash, from: row.from_address, status: row.status},
      mergeHeaders(limit.headers, PRIVATE_CACHE),
    );
  } catch (err) {
    return toResponse(err, "admin-payments", limit.headers);
  }
}
