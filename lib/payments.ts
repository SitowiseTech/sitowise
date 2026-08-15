/**
 * The payments queue: incoming node purchases, from the moment the watcher sees
 * a transfer to the moment a node exists on chain for it.
 *
 * The ordering rule that keeps money from going missing: a payment is written
 * at `seen` BEFORE any mint is attempted. If the process dies mid-mint the row
 * survives and the next pass retries it. Nothing is ever minted from a payment
 * that was not first recorded.
 *
 * `tx_hash` carries a unique index, so re-reading the same block range is
 * harmless and a double mint for one payment is impossible at the database
 * level as well as on chain (the contract's `paymentRefUsed` refuses a repeat).
 */

import {sql, type SqlQuery} from "@/lib/db";

/** Give up after this many failed mint attempts and raise it for a human. */
export const MAX_MINT_ATTEMPTS = 10;

export type PaymentStatus = "seen" | "minting" | "minted" | "failed" | "manual_review";

export type PaymentRow = {
  id: string;
  tx_hash: string;
  from_address: string;
  amount_wei: string;
  block_number: string;
  status: PaymentStatus;
  node_chain_id: string | null;
  mint_tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

/**
 * Record a transfer we just saw. Idempotent: a repeat of the same hash is a
 * no-op, which is what makes re-scanning a block range safe.
 *
 * `status` is decided by the caller because only it knows the expected price:
 * an exact payment goes to `seen`, anything else to `manual_review` so a human
 * looks before a node is handed out.
 */
export async function recordSeen(
  args: {
    txHash: string;
    from: string;
    amountWei: bigint;
    blockNumber: bigint;
    status: Extract<PaymentStatus, "seen" | "manual_review">;
    note?: string;
  },
  // Takes a transaction handle for the same reason setCursor does: the watcher
  // commits a block's payments and the cursor together, so a crash can repeat a
  // block but can never step over one.
  q: SqlQuery = sql,
): Promise<{inserted: boolean}> {
  const rows = await q<{id: string}>`
    insert into payments (tx_hash, from_address, amount_wei, block_number, status, last_error)
    values (
      ${args.txHash.toLowerCase()},
      ${args.from.toLowerCase()},
      ${args.amountWei.toString()},
      ${args.blockNumber.toString()},
      ${args.status},
      ${args.note ?? null}
    )
    on conflict (tx_hash) do nothing
    returning id
  `;
  return {inserted: rows.length > 0};
}

/**
 * Take the next payments that should be minted, moving them out of `seen` in
 * the same statement so a second concurrent pass cannot pick up the same row.
 * Failed rows are retried until `MAX_MINT_ATTEMPTS`.
 */
export async function claimForMinting(limit = 10): Promise<PaymentRow[]> {
  return sql<PaymentRow>`
    update payments
       set status = 'minting', updated_at = now()
     where id in (
       select id from payments
        where (status = 'seen')
           or (status = 'failed' and attempts < ${MAX_MINT_ATTEMPTS})
        order by block_number asc, id asc
        limit ${limit}
        for update skip locked
     )
    returning *
  `;
}

/** A node now exists on chain for this payment. */
export async function markMinted(args: {
  id: string;
  nodeChainId: bigint;
  mintTxHash: string;
}): Promise<void> {
  await sql`
    update payments
       set status = 'minted',
           node_chain_id = ${args.nodeChainId.toString()},
           mint_tx_hash = ${args.mintTxHash.toLowerCase()},
           last_error = null,
           updated_at = now()
     where id = ${args.id}
  `;
}

/**
 * The mint attempt failed. Counts the attempt so the retry loop is bounded, and
 * escalates to `manual_review` once the budget is spent rather than retrying
 * forever against a problem no retry can fix.
 */
export async function markMintFailed(args: {id: string; error: string}): Promise<void> {
  await sql`
    update payments
       set attempts = attempts + 1,
           last_error = ${args.error.slice(0, 500)},
           status = case
             when attempts + 1 >= ${MAX_MINT_ATTEMPTS} then 'manual_review'
             else 'failed'
           end,
           updated_at = now()
     where id = ${args.id}
  `;
}

/** Park a payment for a human. Used for wrong amounts and exhausted retries. */
export async function markManualReview(args: {id: string; reason: string}): Promise<void> {
  await sql`
    update payments
       set status = 'manual_review',
           last_error = ${args.reason.slice(0, 500)},
           updated_at = now()
     where id = ${args.id}
  `;
}

/** Counts per status, for the admin queue view. */
export async function paymentCounts(): Promise<Record<PaymentStatus, number>> {
  const rows = await sql<{status: PaymentStatus; n: string}>`
    select status, count(*)::text as n from payments group by status
  `;
  const out: Record<PaymentStatus, number> = {
    seen: 0,
    minting: 0,
    minted: 0,
    failed: 0,
    manual_review: 0,
  };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

export async function recentPayments(limit = 50): Promise<PaymentRow[]> {
  return sql<PaymentRow>`
    select * from payments order by block_number desc, id desc limit ${limit}
  `;
}

/**
 * A row stuck in `minting` means the process died between claiming it and
 * recording the outcome. Returning it to `failed` lets the normal retry path
 * pick it up; the contract's ref registry makes a duplicate mint impossible
 * even if the original transaction did in fact land.
 */
export async function requeueStuckMinting(olderThanSeconds = 300): Promise<number> {
  const rows = await sql<{id: string}>`
    update payments
       set status = 'failed',
           last_error = 'requeued: stuck in minting',
           updated_at = now()
     where status = 'minting'
       and updated_at < now() - make_interval(secs => ${olderThanSeconds})
    returning id
  `;
  return rows.length;
}

/* ------------------------------------------------------------ block cursor */

/**
 * Where the watcher stopped reading. Without this a restart resumes from the
 * chain head and silently loses every payment made while it was down.
 */
export async function getCursor(key = "payments"): Promise<bigint | null> {
  const rows = await sql<{last_block: string}>`
    select last_block from watcher_state where key = ${key}
  `;
  return rows.length ? BigInt(rows[0].last_block) : null;
}

/** Monotonic: never let a cursor move backwards, even on a bad caller. */
export async function setCursor(block: bigint, key = "payments", q: SqlQuery = sql): Promise<void> {
  await q`
    insert into watcher_state (key, last_block, updated_at)
    values (${key}, ${block.toString()}, now())
    on conflict (key) do update
      set last_block = greatest(watcher_state.last_block, excluded.last_block),
          updated_at = now()
  `;
}
