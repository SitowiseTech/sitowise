/**
 * Node tiers.
 *
 * A tier is a price, a per-wallet allowance, an accrual multiplier, and for
 * everything above the base tier, an amount of SITOWISE the buyer must hold to
 * be allowed to buy it at all.
 *
 * Three things decide the design here.
 *
 * Prices are fixed in **wei, not dollars**. The payment pipeline mints on an
 * exact amount match and parks anything else, which is what makes it safe with
 * no tolerance window to argue about. A dollar price would have to be converted
 * at some rate, at some moment, and the amount a buyer sends would stop being
 * predictable. So a tier costs a round number of ETH and the dollar figure is
 * only ever a label rendered next to it.
 *
 * The amount identifies the tier, so **one payments wallet serves all of them**.
 * A wallet per tier would mean a cursor per tier, three discovery loops, and
 * three balances to keep an eye on, to learn something the amount already says.
 *
 * The per-tier allowances are enforced **off chain, by us, before minting**. The
 * contract knows one number, `maxPerWallet`, and it is the ceiling across all
 * tiers together. This is a real difference from the base cap and the docs must
 * say so plainly rather than implying the contract polices tiers.
 */

import {sql} from "@/lib/db";
import {publicClient} from "@/lib/onchain";
import {readTokenCa} from "@/lib/token";

export type TierId = "base" | "plus" | "prime";

export const TIER_IDS: readonly TierId[] = ["base", "plus", "prime"];

export type Tier = {
  id: TierId;
  label: string;
  /** Exact amount that buys this tier. The pipeline matches on it. */
  priceWei: bigint;
  /** How many of this tier one wallet may hold. Enforced before minting. */
  maxPerWallet: number;
  /** SITOWISE that must be held to buy it. Zero means open to anyone. */
  holdingWei: bigint;
  /**
   * Accrual against the base per-credit range, in basis points. 10000 is the
   * base rate. A tier that costs twice as much and is meant to return twenty
   * percent more per ETH is 2 * 1.2 = 24000.
   */
  payoutBps: number;
  /** A tier can be closed without deleting what was already sold under it. */
  onSale: boolean;
};

const ETH = 10n ** 18n;
const TOKEN = 10n ** 18n;

/**
 * Defaults. Every field is overridable from /admin, and these are what a fresh
 * deployment uses.
 *
 * The dollar labels are for copy only: at the ETH price on the day these were
 * chosen, 0.04 was about $100 and 0.10 about $250.
 */
export const DEFAULT_TIERS: Record<TierId, Tier> = {
  base: {
    id: "base",
    label: "Base",
    priceWei: ETH / 50n, // 0.02
    maxPerWallet: 50,
    holdingWei: 0n,
    payoutBps: 10_000,
    onSale: true,
  },
  plus: {
    id: "plus",
    label: "Plus",
    priceWei: ETH / 25n, // 0.04
    maxPerWallet: 15,
    holdingWei: 1_000_000n * TOKEN,
    // Twice the price, meant to return twenty percent more per ETH.
    payoutBps: 24_000,
    onSale: true,
  },
  prime: {
    id: "prime",
    label: "Prime",
    priceWei: ETH / 10n, // 0.10
    maxPerWallet: 5,
    holdingWei: 3_000_000n * TOKEN,
    // Five times the price, meant to return fifty percent more per ETH.
    payoutBps: 75_000,
    onSale: true,
  },
};

/** Sum of the per-tier allowances. The contract cap must be at least this. */
export function totalAllowance(tiers: Record<TierId, Tier>): number {
  return TIER_IDS.reduce((n, id) => n + tiers[id].maxPerWallet, 0);
}

/* -------------------------------------------------------------- settings -- */

const KEY = (id: TierId, field: string) => `tier.${id}.${field}`;

function parseWei(raw: string): bigint | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function parseCount(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= 0 && n <= 1000 ? n : null;
}

export type ResolvedTiers = {
  tiers: Record<TierId, Tier>;
  /** Stored values that could not be used. Empty in a healthy deployment. */
  problems: string[];
};

/**
 * Defaults with stored rows applied on top.
 *
 * A bad stored value is reported and ignored rather than throwing: a typo in
 * one field must not take the whole sale offline, and /admin shows the problem.
 */
export async function loadTiers(): Promise<ResolvedTiers> {
  const tiers: Record<TierId, Tier> = {
    base: {...DEFAULT_TIERS.base},
    plus: {...DEFAULT_TIERS.plus},
    prime: {...DEFAULT_TIERS.prime},
  };
  const problems: string[] = [];

  let rows: {key: string; value: string}[] = [];
  try {
    rows = await sql<{key: string; value: string}>`
      select key, value from settings where key like 'tier.%'
    `;
  } catch {
    // No database, or no settings table yet. Defaults are a complete answer.
    return {tiers, problems};
  }

  for (const {key, value} of rows) {
    const [, id, field] = key.split(".");
    if (!TIER_IDS.includes(id as TierId)) {
      problems.push(`Unknown tier "${id}" in settings.`);
      continue;
    }
    const tier = tiers[id as TierId];

    switch (field) {
      case "price_wei": {
        const wei = parseWei(value);
        if (wei === null || wei <= 0n) problems.push(`${key} is not a positive wei amount.`);
        else tier.priceWei = wei;
        break;
      }
      case "max_per_wallet": {
        const n = parseCount(value);
        if (n === null) problems.push(`${key} is not a whole number of nodes.`);
        else tier.maxPerWallet = n;
        break;
      }
      case "holding_wei": {
        const wei = parseWei(value);
        if (wei === null) problems.push(`${key} is not a wei amount.`);
        else tier.holdingWei = wei;
        break;
      }
      case "payout_bps": {
        const n = Number(value.trim());
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
          problems.push(`${key} is not a sane basis-point figure.`);
        } else tier.payoutBps = n;
        break;
      }
      case "on_sale": {
        tier.onSale = value.trim() === "true";
        break;
      }
      default:
        problems.push(`Unknown tier field "${field}" in ${key}.`);
    }
  }

  // Two tiers sharing a price would make the amount ambiguous, and the pipeline
  // would mint whichever the lookup happened to reach first.
  const seen = new Map<string, TierId>();
  for (const id of TIER_IDS) {
    const price = tiers[id].priceWei.toString();
    const clash = seen.get(price);
    if (clash) problems.push(`Tiers "${clash}" and "${id}" both cost ${price} wei.`);
    seen.set(price, id);
  }

  return {tiers, problems};
}

export async function saveTierField(
  id: TierId,
  field: "price_wei" | "max_per_wallet" | "holding_wei" | "payout_bps" | "on_sale",
  value: string,
  actor: string,
): Promise<void> {
  await sql`
    insert into settings (key, value, updated_by)
    values (${KEY(id, field)}, ${value}, ${actor})
    on conflict (key) do update
      set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
  `;
}

/** Drop every stored tier row, so the defaults above are in force again. */
export async function clearTierSettings(): Promise<void> {
  await sql`delete from settings where key like 'tier.%'`;
}

/* ------------------------------------------------------------ resolution -- */

/** Which tier an exact payment buys, or null if the amount is not a tier price. */
export function tierForAmount(
  amountWei: bigint,
  tiers: Record<TierId, Tier>,
): Tier | null {
  for (const id of TIER_IDS) {
    if (tiers[id].priceWei === amountWei) return tiers[id];
  }
  return null;
}

/** Read a stored tier id back, tolerating rows written before tiers existed. */
export function tierById(id: string | null | undefined, tiers: Record<TierId, Tier>): Tier {
  return TIER_IDS.includes(id as TierId) ? tiers[id as TierId] : tiers.base;
}

/* ----------------------------------------------------------- eligibility -- */

export type Holding =
  | {ok: true; balanceWei: bigint; token: `0x${string}`}
  | {ok: false; reason: string};

/**
 * How much SITOWISE an address holds.
 *
 * The token address comes from the same published setting the site header
 * shows, so there is one answer to "which token is this" across the whole
 * product. Before the token is published there is nothing to gate on, and the
 * gated tiers are simply unavailable rather than open to everyone.
 */
export async function holdingOf(address: `0x${string}`): Promise<Holding> {
  const token = await readTokenCa();
  if (!token) return {ok: false, reason: "The token address has not been published yet."};

  try {
    const balanceWei = (await publicClient().readContract({
      address: token,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{name: "account", type: "address"}],
          outputs: [{name: "", type: "uint256"}],
        },
      ] as const,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    return {ok: true, balanceWei, token};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {ok: false, reason: message.split("\n")[0]};
  }
}

/* ----------------------------------------------------------- allowances -- */

/** How many of each tier one wallet already holds, from the ledger. */
export async function tierCountsFor(address: string): Promise<Record<TierId, number>> {
  const counts: Record<TierId, number> = {base: 0, plus: 0, prime: 0};
  const rows = await sql<{tier: string; n: string}>`
    select tier, count(*)::text as n
      from nodes
     where lower(owner_address) = ${address.toLowerCase()}
       and status = 'active'
     group by tier
  `;
  for (const row of rows) {
    if (TIER_IDS.includes(row.tier as TierId)) counts[row.tier as TierId] = Number(row.n);
  }
  return counts;
}

/**
 * Allowance usage per tier, counted from payments rather than from nodes.
 *
 * Nodes reach the ledger through the reconciler, which runs on its own timer,
 * so a node minted twenty seconds ago is not in `nodes` yet. Counting nodes
 * would let a burst of payments each see an allowance that the ones before them
 * have already spent. Payments are written synchronously by the pipeline, so
 * they are the only count that is true at the moment of the decision.
 *
 * Everything that has not been refused counts: minted, in flight, and retrying.
 * A payment parked in manual_review or refunded does not, because neither will
 * ever become a node without somebody deliberately putting it back.
 *
 * Rows written before tiers existed carry no tier and are base nodes.
 */
export async function tierUsageFor(address: string): Promise<Record<TierId, number>> {
  const counts: Record<TierId, number> = {base: 0, plus: 0, prime: 0};
  const rows = await sql<{tier: string; n: string}>`
    select coalesce(tier, 'base') as tier, count(*)::text as n
      from payments
     where lower(from_address) = ${address.toLowerCase()}
       and status in ('seen', 'minting', 'failed', 'minted')
     group by coalesce(tier, 'base')
  `;
  for (const row of rows) {
    if (TIER_IDS.includes(row.tier as TierId)) counts[row.tier as TierId] = Number(row.n);
  }
  return counts;
}
