/**
 * Indexing withdrawals.
 *
 * Withdrawals were the one part of the ledger nothing ever wrote. The table has
 * existed since migration 002 and the event decoder since not long after, but
 * no code called either, so every public page derived a node's balance as
 * credited minus zero. A holder who had already taken their money out was shown
 * it still sitting there, once by a factor of twenty.
 *
 * The money figures now come from the contract, so those pages are right
 * whatever this module does. What is still missing without it is the history:
 * when a withdrawal happened, for how much, and in which transaction.
 *
 * Unlike payments, this is easy. A withdrawal emits `Withdrawn`, so it can be
 * found with a log filter instead of by reading blocks: the entire history of
 * the contract comes back in one `eth_getLogs` call in about a third of a
 * second. None of the difficulty that makes payment discovery fragile applies
 * here, which is worth saying plainly because the two look similar and are not.
 */

import {parseEventLogs} from "viem";
import {FACTORY_ABI} from "@/lib/abi";
import {sql} from "@/lib/db";
import {factoryAddress, watcherConfig} from "@/lib/env";
import {getCursor, setCursor} from "@/lib/payments";
import {rpc} from "@/lib/rpc";

/** Key in `watcher_state`. Separate from the payments cursor, on purpose. */
export const WITHDRAWALS_CURSOR = "withdrawals";

/**
 * Where a first run starts. The contract cannot have emitted anything before
 * it existed, and starting at zero costs one wasted call rather than being
 * wrong, so this is a floor rather than a fact to be kept up to date.
 */
const FIRST_BLOCK = 0n;

/** The most one pass will claim. Wide, because one call answers for any range. */
const MAX_SPAN = 2_000_000n;

export type WithdrawalScan = {
  fromBlock: string;
  toBlock: string;
  found: number;
  inserted: number;
  caughtUp: boolean;
};

/**
 * One pass. Safe to call on a timer and safe to call twice: rows are unique per
 * transaction and node, and the cursor only advances over ground actually read.
 */
export async function indexWithdrawals(): Promise<WithdrawalScan> {
  const cfg = watcherConfig();
  const client = rpc();
  const address = factoryAddress();

  const head = await client.getBlockNumber();
  const safeHead = head > cfg.confirmations ? head - cfg.confirmations : 0n;

  const cursor = await getCursor(WITHDRAWALS_CURSOR);
  const from = cursor === null ? FIRST_BLOCK : cursor + 1n;
  if (from > safeHead) {
    return {
      fromBlock: from.toString(),
      toBlock: safeHead.toString(),
      found: 0,
      inserted: 0,
      caughtUp: true,
    };
  }

  const to = safeHead - from > MAX_SPAN ? from + MAX_SPAN : safeHead;

  const logs = await client.getLogs({
    address,
    event: FACTORY_ABI.find(
      (item) => item.type === "event" && item.name === "Withdrawn",
    ) as never,
    fromBlock: from,
    toBlock: to,
  });

  const parsed = parseEventLogs({abi: FACTORY_ABI, eventName: "Withdrawn", logs});

  // Block timestamps, so the history reads as when it happened rather than as
  // when we got round to indexing it. One read per distinct block, and the RPC
  // transport batches them into one request.
  const blocks = [...new Set(parsed.map((log) => log.blockNumber))];
  const times = new Map<bigint, Date>();
  await Promise.all(
    blocks.map(async (blockNumber) => {
      try {
        const block = await client.getBlock({blockNumber});
        times.set(blockNumber, new Date(Number(block.timestamp) * 1000));
      } catch {
        // A missing timestamp is not a reason to lose the row.
      }
    }),
  );

  let inserted = 0;
  for (const log of parsed) {
    const {id, to: recipient, amount} = log.args as {
      id: bigint;
      to: `0x${string}`;
      amount: bigint;
    };
    // Zero-amount withdrawals cannot happen: the contract reverts on them. The
    // check is here because the column refuses them and a surprise would
    // otherwise abort the whole pass.
    if (amount <= 0n) continue;

    const observed = times.get(log.blockNumber) ?? new Date();
    const rows = await sql<{id: string}>`
      insert into withdrawals
        (node_chain_id, to_address, amount_wei, tx_hash, block_number, observed_at)
      values (
        ${id.toString()},
        ${recipient.toLowerCase()},
        ${amount.toString()},
        ${log.transactionHash.toLowerCase()},
        ${log.blockNumber.toString()},
        ${observed.toISOString()}
      )
      on conflict (tx_hash, node_chain_id) do nothing
      returning id
    `;
    if (rows.length > 0) inserted++;
  }

  await setCursor(to, WITHDRAWALS_CURSOR);

  return {
    fromBlock: from.toString(),
    toBlock: to.toString(),
    found: parsed.length,
    inserted,
    caughtUp: to >= safeHead,
  };
}
