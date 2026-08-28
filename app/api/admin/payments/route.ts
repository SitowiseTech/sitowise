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
import {readParkedPayments, requeuePayment} from "@/lib/payments";
import {adoptPayment} from "@/lib/watcher";

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "admin-payments", {limit: 30});
  if (limit.blocked) return limit.blocked;

  try {
    requireAdmin(req);
    const rows = await readParkedPayments();
    return jsonOk(
      {
        payments: rows.map((row) => ({
          txHash: row.tx_hash,
          from: row.from_address,
          amountWei: row.amount_wei,
          blockNumber: row.block_number,
          status: row.status,
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

    const row = await requeuePayment(txHash);
    if (!row) {
      // Not parked. Either it is already minted, or discovery never recorded it
      // at all, which is the case a cursor that stepped over a block leaves
      // behind. Adoption re-reads the transaction from the chain and records it
      // if it really is a payment, so the second case is recoverable here
      // instead of needing a day of cursor rewound.
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
