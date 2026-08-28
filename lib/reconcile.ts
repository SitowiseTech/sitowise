/**
 * Reconciler (spec section 11).
 *
 * A node only starts accruing once it exists in the database, and the database
 * only learns about a node when POST /api/nodes/sync is called. That call can
 * be missed: the browser can be closed between the wallet confirming and the
 * request going out, and a node can be minted straight against the contract
 * without the site ever being involved. Those nodes are paid for and would
 * otherwise sit dead forever.
 *
 * So the chain, not the site, is the register. This module compares
 * `totalNodes()` against the rows we hold and inserts whatever is missing,
 * taking the owner and the price paid from the mint log rather than from
 * anyone's word for it.
 *
 * Cheap when there is nothing to do: one eth_call plus one indexed query, and
 * no log scanning at all when the counts already agree.
 */

import {randomInt} from "node:crypto";
import {sql, tx} from "@/lib/db";
import {distConfig, nodePriceWei} from "@/lib/env";
import {chainTotalNodes, mintLogsForIds, ownerOfNode, type MintedLog} from "@/lib/rpc";
import {scheduleNewNode} from "@/lib/schedule";

/** A node as it now stands in the database, plus whether this call created it. */
export type RecordedNode = {
  id: number;
  chainNodeId: string;
  ownerAddress: string;
  mintTxHash: string;
  priceWei: string;
  createdAt: string | null;
  inserted: boolean;
};

type NodeRow = {
  id: string | number;
  chain_node_id: string;
  owner_address: string;
  mint_tx_hash: string;
  price_wei: string;
  created_at: Date | string | null;
};

function shape(row: NodeRow, inserted: boolean): RecordedNode {
  return {
    id: Number(row.id),
    chainNodeId: String(row.chain_node_id),
    ownerAddress: String(row.owner_address),
    mintTxHash: String(row.mint_tx_hash),
    priceWei: String(row.price_wei),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at
          ? new Date(row.created_at).toISOString()
          : null,
    inserted,
  };
}

/** A node's first credit delay, from the configured window. Inclusive of the maximum. */
function firstDelaySeconds(): number {
  const {minDelaySec, maxDelaySec} = distConfig();
  return randomInt(minDelaySec, maxDelaySec + 1);
}

/**
 * Write mint logs into the ledger, one transaction for the batch.
 *
 * Idempotent by construction: `mint_tx_hash` and `chain_node_id` are both
 * unique, so a resubmitted sync or an overlapping reconcile run inserts
 * nothing and reports the row that was already there. The wallet row is
 * created first because nodes.owner_address references it.
 *
 * Every node also leaves here with a credit timer. A node with a ledger row but
 * no `node_schedule` row is never due, so it never accrues and nothing in the
 * system ever complains: it is simply a paid node that earns nothing forever.
 * The insert is a no-op for a node that already has one, so this doubles as a
 * repair for any node that lost its timer.
 */
export async function recordMintedNodes(mints: MintedLog[]): Promise<RecordedNode[]> {
  if (mints.length === 0) return [];

  // NodeMinted carries no price: payment happens off chain, so the contract
  // never learns what a node cost. The payment that produced the mint does know,
  // and it is looked up per node below. A mint with no payment row behind it was
  // made outside the site, and falls back to the configured base price.
  const fallbackPriceWei = nodePriceWei();

  return tx(async (q) => {
    const recorded: RecordedNode[] = [];

    for (const mint of mints) {
      await q`
        insert into wallets (address) values (${mint.owner})
        on conflict (address) do nothing
      `;

      // What the buyer actually paid, and which tier that bought. Taken from the
      // payment rather than from configuration, so a later price change cannot
      // rewrite what an earlier sale cost or which tier it belonged to.
      const paid = await q<{amount_wei: string; tier: string | null}>`
        select amount_wei, tier from payments
         where lower(mint_tx_hash) = ${mint.txHash.toLowerCase()}
         limit 1
      `;
      const priceWei = paid[0]?.amount_wei ?? fallbackPriceWei.toString();
      const tier = paid[0]?.tier ?? "base";

      // No conflict target: either unique constraint hitting means the node is
      // already recorded, and both mean the same thing to us.
      const inserted = await q<NodeRow>`
        insert into nodes (chain_node_id, owner_address, mint_tx_hash, price_wei, tier)
        values (
          ${mint.chainNodeId.toString()},
          ${mint.owner},
          ${mint.txHash},
          ${priceWei},
          ${tier}
        )
        on conflict do nothing
        returning id, chain_node_id, owner_address, mint_tx_hash, price_wei, created_at
      `;

      // Drawn per node, not once per batch: a reconcile that adopted twenty
      // orphaned nodes with one shared delay would put all twenty on the same
      // beat for the rest of their lives.
      await scheduleNewNode(mint.chainNodeId, firstDelaySeconds(), q);

      if (inserted.length > 0) {
        recorded.push(shape(inserted[0], true));
        continue;
      }

      const existing = await q<NodeRow>`
        select id, chain_node_id, owner_address, mint_tx_hash, price_wei, created_at
        from nodes
        where chain_node_id = ${mint.chainNodeId.toString()}::numeric
      `;
      if (existing.length > 0) recorded.push(shape(existing[0], false));
    }

    return recorded;
  });
}

/* ------------------------------------------------------------- reconciling */

export type ReconcileOptions = {
  /** Defaults to the whole chain; the factory emits few enough logs for that to be fast. */
  fromBlock?: bigint;
  toBlock?: bigint;
  /** Ceiling on how many missing nodes one call will chase. Repeat the call to continue. */
  maxNodes?: number;
};

export type ReconcileResult = {
  chainTotalNodes: string;
  /** Ids the chain has and the ledger did not, newest first, capped at `maxNodes`. */
  missing: string[];
  inserted: RecordedNode[];
  /** Missing ids whose mint log was not in the scanned range. Nothing was invented for them. */
  unresolved: string[];
  /** Ids whose log owner disagreed with the current on-chain owner, so they were left alone. */
  rejected: string[];
  logRequests: number;
  scannedFromBlock: string | null;
  scannedToBlock: string | null;
};

const DEFAULT_MAX_NODES = 50;

/** Missing ids, newest first. The descending series lets the LIMIT stop the scan early. */
async function missingChainNodeIds(total: bigint, limit: number): Promise<bigint[]> {
  const rows = await sql<{chain_node_id: string}>`
    select gs.id::text as chain_node_id
    from generate_series(${total.toString()}::bigint, 1, -1) as gs(id)
    left join nodes n on n.chain_node_id = gs.id::numeric
    where n.id is null
    limit ${limit}::int
  `;
  return rows.map((row) => BigInt(row.chain_node_id));
}

/**
 * Bring the ledger level with the chain. Safe to run on a timer and safe to run
 * twice at once: every write goes through `recordMintedNodes`, which is a no-op
 * for a node that already exists.
 */
export async function reconcileNodes(opts: ReconcileOptions = {}): Promise<ReconcileResult> {
  const maxNodes = Math.max(1, Math.min(opts.maxNodes ?? DEFAULT_MAX_NODES, 500));
  const total = await chainTotalNodes();

  const empty: ReconcileResult = {
    chainTotalNodes: total.toString(),
    missing: [],
    inserted: [],
    unresolved: [],
    rejected: [],
    logRequests: 0,
    scannedFromBlock: null,
    scannedToBlock: null,
  };

  if (total === 0n) return empty;

  const missing = await missingChainNodeIds(total, maxNodes);
  if (missing.length === 0) return empty;

  const fromBlock = opts.fromBlock ?? 0n;
  const scan = await mintLogsForIds(missing, {fromBlock, toBlock: opts.toBlock});

  // One log per id: the contract emits NodeMinted exactly once per id and ids
  // are never reused. If a reorg ever produced two, the later block wins.
  const byId = new Map<string, MintedLog>();
  for (const log of scan.logs) {
    const key = log.chainNodeId.toString();
    const seen = byId.get(key);
    if (!seen || (log.blockNumber ?? 0n) >= (seen.blockNumber ?? 0n)) byId.set(key, log);
  }

  const confirmed: MintedLog[] = [];
  const rejected: string[] = [];

  for (const log of byId.values()) {
    // The log came from the factory's own address, but a log read from a block
    // that later reorged out would still parse. nodeInfo() answers from current
    // state, so it settles which owner the chain believes in today.
    const owner = await ownerOfNode(log.chainNodeId);
    if (owner === log.owner) confirmed.push(log);
    else rejected.push(log.chainNodeId.toString());
  }

  const inserted = await recordMintedNodes(confirmed);
  const resolved = new Set(confirmed.map((log) => log.chainNodeId.toString()));

  return {
    chainTotalNodes: total.toString(),
    missing: missing.map(String),
    inserted,
    unresolved: missing
      .map(String)
      .filter((id) => !resolved.has(id) && !rejected.includes(id)),
    rejected,
    logRequests: scan.requests,
    scannedFromBlock: scan.fromBlock.toString(),
    scannedToBlock: scan.toBlock.toString(),
  };
}
