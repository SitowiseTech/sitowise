/**
 * The /admin snapshot (spec 14), assembled from three sources that fail
 * independently: the database, the chain, and the environment.
 *
 * Each is wrapped, so a dead RPC still shows the ledger and an unreachable
 * database still shows the contract. The page needs to be usable precisely when
 * something is broken, which is the one time a page that throws is useless.
 */

import {type Alert, openAlerts, recentAlerts} from "@/lib/alerts";
import {sql} from "@/lib/db";
import {paymentAddress} from "@/lib/env";
import {recentDistributions, type DistributionRow} from "@/lib/ledger";
import {readBalance, readFactory, type ChainRead, type FactorySnapshot} from "@/lib/onchain";
import {loadSettings, type ResolvedSettings} from "@/lib/settings";
import {loadTiers, TIER_IDS} from "@/lib/tiers";
import {watcherStatus, type WatcherHealth} from "@/lib/watcher";
import {isStalled, readWorkerState, silentFor, type WorkerState} from "@/lib/workerState";

export type LedgerTotals = {
  activeNodes: number;
  retiredNodes: number;
  operators: number;
  cumulativeWei: bigint;
  withdrawnWei: bigint;
  /** What node holders are owed right now. The number the contract must cover. */
  unwithdrawnWei: bigint;
  rounds24h: number;
  distributed24hWei: bigint;
  lastDistributionAt: Date | null;

  /* ---- lifetime figures ----
     The panels above this addition only ever showed liquidity and a 24h window,
     so the totals that answer "how is this actually going" were computed and
     then thrown away. These are the all-time numbers. */

  /** Sales that produced a node. Payments still in flight are counted apart. */
  soldNodes: number;
  /** ETH taken in for those sales. The only money coming *in*. */
  revenueWei: bigint;
  /** Sales seen but not yet minted, and ones that need a human. */
  pendingPayments: number;
  reviewPayments: number;
  failedPayments: number;
  /** How many times holders have actually pulled money out. */
  withdrawalCount: number;
  withdrawers: number;
  /** Rolling 24h, to compare against the lifetime figures beside them. */
  soldNodes24h: number;
  revenue24hWei: bigint;
  withdrawn24hWei: bigint;
  firstSaleAt: Date | null;
  lastSaleAt: Date | null;
  lastWithdrawalAt: Date | null;
};

/**
 * One observed `Withdrawn` event. Every row is already settled on chain, so
 * there is no pending status and no separate confirmation time: if the row
 * exists, the money moved.
 */
/**
 * One wallet that has bought nodes.
 *
 * Grouped by the paying address rather than by node, because the question this
 * answers is "who is buying", and one buyer holding twenty five nodes is a very
 * different fact from twenty five buyers holding one each.
 */
export type BuyerRow = {
  address: string;
  nodes: number;
  spentWei: bigint;
  firstBuyAt: Date;
  lastBuyAt: Date;
  nodeIds: string[];
};

export type WithdrawalRow = {
  id: number;
  chainNodeId: string;
  toAddress: string;
  amountWei: bigint;
  txHash: string;
  blockNumber: number;
  observedAt: Date;
};

export type WorkerHealth = {
  state: WorkerState | null;
  stalled: boolean;
  silentSec: number | null;
};

/**
 * One tier, as money rather than as configuration.
 *
 * The tier form answers "what are the rules". This answers "what did the rules
 * cost", which is the question that decides whether a tier stays open. Revenue
 * and payouts are both counted here so the two sit side by side: a tier can
 * look busy and still be the one draining the float.
 */
export type TierMoney = {
  id: string;
  label: string;
  /** Nodes sold at this tier, from the ledger. */
  nodes: number;
  /** ETH taken in for them. */
  revenueWei: bigint;
  /** ETH credited to their balances, all time. */
  creditedWei: bigint;
  /** Credited in the last 24 hours, to compare against the daily cap. */
  credited24hWei: bigint;
  /** What one node of this tier draws per credit, after the multiplier. */
  perCreditMinWei: bigint;
  perCreditMaxWei: bigint;
  /** Rough ETH per node per day at the configured interval. */
  perDayWei: bigint;
};

export type AdminSnapshot = {
  chain: ChainRead<FactorySnapshot>;
  /**
   * Payment discovery. Its own field rather than a line in `worker`, because the
   * two fail separately: the distribution worker can be perfectly healthy while
   * nobody is watching the wallet that takes the money.
   */
  watcher: WatcherHealth | null;
  watcherError: string | null;
  treasury: {address: `0x${string}` | null; balance: ChainRead<bigint> | null; error: string | null};
  ledger: LedgerTotals | null;
  ledgerError: string | null;
  settings: ResolvedSettings | null;
  settingsError: string | null;
  worker: WorkerHealth;
  distributions: DistributionRow[];
  withdrawals: WithdrawalRow[];
  buyers: BuyerRow[];
  /** Per-tier money. Empty when the ledger could not be read. */
  tierMoney: TierMoney[];
  alerts: Alert[];
  alertHistory: Alert[];
  /** Difference between what the contract holds and what it owes. Negative is the alarm. */
  coverageWei: bigint | null;
  /** How much to send the contract now, or null when nothing is needed. */
  suggestedTopUpWei: bigint | null;
  /** Projected spend per day at the current settings and node count. */
  dailySpendWei: bigint | null;
};

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : String(err);
}

/* ------------------------------------------------------------------ ledger */

async function readLedger(): Promise<LedgerTotals> {
  const [row] = await sql<{
    active_nodes: string;
    retired_nodes: string;
    operators: string;
    cumulative: string;
    withdrawn: string;
    unwithdrawn: string;
    rounds_24h: string;
    total_24h: string;
    last_at: Date | string | null;
    sold_nodes: string;
    revenue: string;
    pending_payments: string;
    review_payments: string;
    failed_payments: string;
    withdrawal_count: string;
    withdrawers: string;
    sold_24h: string;
    revenue_24h: string;
    withdrawn_24h: string;
    first_sale_at: Date | string | null;
    last_sale_at: Date | string | null;
    last_withdrawal_at: Date | string | null;
  }>`
    select
      (select count(*) from nodes where status = 'active')                      as active_nodes,
      (select count(*) from nodes where status = 'retired')                     as retired_nodes,
      (select count(distinct owner_address) from nodes where status = 'active') as operators,
      -- node_balances was dropped in migration 002; the contract owns balances
      -- now. node_view derives these from recorded history instead, so the
      -- ledger totals stay available without a second source of truth.
      (select coalesce(sum(cumulative_wei), 0) from node_view)                  as cumulative,
      (select coalesce(sum(withdrawn_wei), 0) from node_view)                   as withdrawn,
      (select coalesce(sum(balance_wei), 0) from node_view)                     as unwithdrawn,
      (select count(*) from distributions
        where created_at > now() - interval '24 hours')                         as rounds_24h,
      (select coalesce(sum(total_wei), 0) from distributions
        where created_at > now() - interval '24 hours')                         as total_24h,
      (select max(created_at) from distributions)                               as last_at,

      -- Money in. 'minted' only: a payment that never became a node is not
      -- revenue, and lumping the two together would overstate every figure
      -- derived from this one.
      (select count(*) from payments where status = 'minted')                   as sold_nodes,
      (select coalesce(sum(amount_wei), 0) from payments
        where status = 'minted')                                                as revenue,
      (select count(*) from payments where status in ('seen','minting'))        as pending_payments,
      (select count(*) from payments where status = 'manual_review')            as review_payments,
      (select count(*) from payments where status = 'failed')                   as failed_payments,

      -- Money out, as holders actually took it: settled Withdrawn events.
      (select count(*) from withdrawals)                                        as withdrawal_count,
      (select count(distinct to_address) from withdrawals)                      as withdrawers,

      (select count(*) from payments
        where status = 'minted' and created_at > now() - interval '24 hours')   as sold_24h,
      (select coalesce(sum(amount_wei), 0) from payments
        where status = 'minted' and created_at > now() - interval '24 hours')   as revenue_24h,
      (select coalesce(sum(amount_wei), 0) from withdrawals
        where observed_at > now() - interval '24 hours')                        as withdrawn_24h,

      (select min(created_at) from payments where status = 'minted')            as first_sale_at,
      (select max(created_at) from payments where status = 'minted')            as last_sale_at,
      (select max(observed_at) from withdrawals)                                as last_withdrawal_at
  `;

  return {
    activeNodes: Number(row.active_nodes),
    retiredNodes: Number(row.retired_nodes),
    operators: Number(row.operators),
    cumulativeWei: BigInt(row.cumulative),
    withdrawnWei: BigInt(row.withdrawn),
    unwithdrawnWei: BigInt(row.unwithdrawn),
    rounds24h: Number(row.rounds_24h),
    distributed24hWei: BigInt(row.total_24h),
    lastDistributionAt: row.last_at === null ? null : toDate(row.last_at),
    soldNodes: Number(row.sold_nodes),
    revenueWei: BigInt(row.revenue),
    pendingPayments: Number(row.pending_payments),
    reviewPayments: Number(row.review_payments),
    failedPayments: Number(row.failed_payments),
    withdrawalCount: Number(row.withdrawal_count),
    withdrawers: Number(row.withdrawers),
    soldNodes24h: Number(row.sold_24h),
    revenue24hWei: BigInt(row.revenue_24h),
    withdrawn24hWei: BigInt(row.withdrawn_24h),
    firstSaleAt: row.first_sale_at === null ? null : toDate(row.first_sale_at),
    lastSaleAt: row.last_sale_at === null ? null : toDate(row.last_sale_at),
    lastWithdrawalAt:
      row.last_withdrawal_at === null ? null : toDate(row.last_withdrawal_at),
  };
}

/**
 * Withdrawals are indexed from on-chain `Withdrawn` events (migration 002), so
 * every row is already settled: there is no pending status, no signed allowance
 * and no separate confirmation time to show. The chain node id comes straight
 * off the event, so no join against `nodes` is needed — and must not be used,
 * because a node minted directly against the contract may have no row there yet.
 */
async function readWithdrawals(limit = 50): Promise<WithdrawalRow[]> {
  const rows = await sql<{
    id: string;
    node_chain_id: string;
    to_address: string;
    amount_wei: string;
    tx_hash: string;
    block_number: string;
    observed_at: Date | string;
  }>`
    select id, node_chain_id, to_address, amount_wei, tx_hash, block_number, observed_at
    from withdrawals
    order by block_number desc, id desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    chainNodeId: r.node_chain_id,
    toAddress: r.to_address,
    amountWei: BigInt(r.amount_wei),
    txHash: r.tx_hash,
    blockNumber: Number(r.block_number),
    observedAt: toDate(r.observed_at),
  }));
}

/* ------------------------------------------------------------------ sizing */

const SECONDS_PER_DAY = 86_400n;
/** Spec 15: hold at least three days of payouts on the contract. */
const COVER_DAYS = 3n;

/**
 * Projected daily spend at the current settings. Treasury mode only: with
 * DIST_MODE=swaps the payouts are funded by what the hook already took, so
 * there is no forward spend to size against.
 */
function projectDailySpend(settings: ResolvedSettings, activeNodes: number): bigint {
  if (settings.config.mode !== "treasury" || activeNodes === 0) return 0n;
  const {minAmountWei, maxAmountWei, minDelaySec, maxDelaySec} = settings.config;
  const averageAmount = (minAmountWei + maxAmountWei) / 2n;
  const averageDelay = BigInt(minDelaySec + maxDelaySec) / 2n;
  if (averageDelay === 0n) return 0n;
  const roundsPerDay = SECONDS_PER_DAY / averageDelay;
  return averageAmount * roundsPerDay * BigInt(activeNodes);
}

/* --------------------------------------------------------------- snapshot */

/**
 * Who is buying, grouped by paying wallet.
 *
 * Only `minted` payments count: a payment that never became a node is not a
 * purchase, and including it would inflate both the wallet count and the spend.
 * Ordered by node count so the largest holder is the first thing seen, because
 * concentration is the fact most worth noticing here.
 */
/**
 * Money grouped by tier.
 *
 * Credits are joined through `nodes`, not through payments: a credit belongs to
 * a node, and the node is what carries the tier. Rows written before tiers
 * existed have no tier and are counted as base.
 */
async function readTierMoney(): Promise<
  Map<string, {nodes: number; revenueWei: bigint; creditedWei: bigint; credited24hWei: bigint}>
> {
  const rows = await sql<{
    tier: string;
    nodes: string;
    revenue_wei: string;
    credited_wei: string;
    credited_24h_wei: string;
  }>`
    select
      coalesce(n.tier, 'base')                                   as tier,
      count(*)::text                                             as nodes,
      coalesce(sum(n.price_wei), 0)::text                        as revenue_wei,
      coalesce(sum(c.total), 0)::text                            as credited_wei,
      coalesce(sum(c.total_24h), 0)::text                        as credited_24h_wei
    from nodes n
    left join lateral (
      select
        sum(amount_wei)                                                        as total,
        sum(amount_wei) filter (where created_at > now() - interval '24 hours') as total_24h
      from credits where node_id = n.id
    ) c on true
    where n.status = 'active'
    group by coalesce(n.tier, 'base')
  `;

  return new Map(
    rows.map((r) => [
      r.tier,
      {
        nodes: Number(r.nodes),
        revenueWei: BigInt(r.revenue_wei),
        creditedWei: BigInt(r.credited_wei),
        credited24hWei: BigInt(r.credited_24h_wei),
      },
    ]),
  );
}

async function readBuyers(limit = 50): Promise<BuyerRow[]> {
  const rows = await sql<{
    from_address: string;
    nodes: string;
    spent: string;
    first_buy: Date | string;
    last_buy: Date | string;
    node_ids: string[] | null;
  }>`
    select from_address,
           count(*)                                            as nodes,
           coalesce(sum(amount_wei), 0)                         as spent,
           min(created_at)                                      as first_buy,
           max(created_at)                                      as last_buy,
           array_agg(node_chain_id::text order by created_at)   as node_ids
      from payments
     where status = 'minted'
     group by from_address
     order by count(*) desc, min(created_at)
     limit ${limit}
  `;
  return rows.map((r) => ({
    address: r.from_address,
    nodes: Number(r.nodes),
    spentWei: BigInt(r.spent),
    firstBuyAt: toDate(r.first_buy),
    lastBuyAt: toDate(r.last_buy),
    nodeIds: (r.node_ids ?? []).filter((id): id is string => id !== null),
  }));
}

export async function adminSnapshot(): Promise<AdminSnapshot> {
  const chain = await readFactory();

  // Wrapped like everything else here: an unreachable explorer must show up as
  // "discovery is blind", not as a console that refuses to render.
  let watcher: WatcherHealth | null = null;
  let watcherError: string | null = null;
  try {
    watcher = await watcherStatus();
  } catch (err) {
    watcherError = message(err);
  }

  let treasury: AdminSnapshot["treasury"] = {address: null, balance: null, error: null};
  try {
    // The payments wallet. Node purchases are plain transfers to it; the
    // contract never touches them, so its balance is only visible from env.
    const address = paymentAddress();
    treasury = {address, balance: await readBalance(address), error: null};
  } catch (err) {
    treasury = {address: null, balance: null, error: message(err)};
  }

  let ledger: LedgerTotals | null = null;
  let ledgerError: string | null = null;
  let distributions: DistributionRow[] = [];
  let withdrawals: WithdrawalRow[] = [];
  let buyers: BuyerRow[] = [];
  let tierMoney: TierMoney[] = [];
  let alerts: Alert[] = [];
  let alertHistory: Alert[] = [];
  let worker: WorkerHealth = {state: null, stalled: false, silentSec: null};

  try {
    const [totals, dist, wd, buy, open, history, state, money] = await Promise.all([
      readLedger(),
      recentDistributions(50),
      readWithdrawals(50),
      readBuyers(50),
      openAlerts(),
      recentAlerts(20),
      readWorkerState(),
      readTierMoney(),
    ]);
    ledger = totals;
    distributions = dist;
    withdrawals = wd;
    buyers = buy;
    alerts = open;
    alertHistory = history;
    worker = {state, stalled: isStalled(state), silentSec: silentFor(state)};

    // The configured range and the tier multipliers turn the raw totals above
    // into the two numbers an operator actually decides on: what one node of
    // this tier draws per credit, and what that comes to over a day.
    const [{tiers}, resolved] = await Promise.all([loadTiers(), loadSettings()]);
    const cfg = resolved.config;
    // The tick quantises the per-node delay, so the average interval is the
    // midpoint of the configured window. Rough on purpose, and labelled as such.
    const avgIntervalSec = BigInt(Math.max(1, Math.round((cfg.minDelaySec + cfg.maxDelaySec) / 2)));
    const perDay = 86_400n / avgIntervalSec;

    tierMoney = TIER_IDS.map((id) => {
      const spec = tiers[id];
      const bps = BigInt(spec.payoutBps);
      const row = money.get(id) ?? {
        nodes: 0,
        revenueWei: 0n,
        creditedWei: 0n,
        credited24hWei: 0n,
      };
      const minWei = (cfg.minAmountWei * bps) / 10_000n;
      const maxWei = (cfg.maxAmountWei * bps) / 10_000n;
      return {
        id,
        label: spec.label,
        ...row,
        perCreditMinWei: minWei,
        perCreditMaxWei: maxWei,
        perDayWei: ((minWei + maxWei) / 2n) * perDay,
      };
    });
  } catch (err) {
    ledgerError = message(err);
  }

  let settings: ResolvedSettings | null = null;
  let settingsError: string | null = null;
  try {
    settings = await loadSettings();
  } catch (err) {
    settingsError = message(err);
  }

  const balanceWei = chain.ok ? chain.data.balanceWei : null;
  const unwithdrawnWei = ledger?.unwithdrawnWei ?? null;
  const coverageWei =
    balanceWei !== null && unwithdrawnWei !== null ? balanceWei - unwithdrawnWei : null;

  const dailySpendWei =
    settings && ledger ? projectDailySpend(settings, ledger.activeNodes) : null;

  let suggestedTopUpWei: bigint | null = null;
  if (balanceWei !== null && unwithdrawnWei !== null && dailySpendWei !== null) {
    const target = unwithdrawnWei + dailySpendWei * COVER_DAYS;
    suggestedTopUpWei = target > balanceWei ? target - balanceWei : null;
  }

  return {
    chain,
    watcher,
    watcherError,
    treasury,
    ledger,
    ledgerError,
    settings,
    settingsError,
    worker,
    distributions,
    withdrawals,
    buyers,
    tierMoney,
    alerts,
    alertHistory,
    coverageWei,
    suggestedTopUpWei,
    dailySpendWei,
  };
}
