/**
 * What a credit pass is allowed to do, as pure functions.
 *
 * Nothing here reads the chain or the database. The caller gathers the numbers
 * once and asks these functions for a verdict, so the rules that decide whether
 * real ETH moves can be read end to end in one screen and reasoned about
 * without a running deployment.
 *
 * Every rail refuses the whole pass rather than trimming it. A half-sized batch
 * would quietly hide the condition that triggered it, and the timers of the
 * nodes it skipped would be indistinguishable from nodes that were simply not
 * due yet.
 */

import type {DistMode} from "@/lib/env";
import {formatEthLabel} from "@/lib/format";

/**
 * A refused pass. `reason` is the stable machine string the API returns and
 * /admin switches on; `message` is the sentence a human reads.
 */
export type Refusal<R extends string = string> = {
  reason: R;
  message: string;
  detail?: Record<string, unknown>;
};

/* -------------------------------------------------------------------- mode */

export type ModeRefusal = Refusal<"mode_unavailable">;

/**
 * DIST_MODE=swaps used to credit what a Uniswap v4 hook took from swap flow.
 * That hook is gone, and with it the only chain source the mode ever had.
 *
 * There is no chain source to read, so the honest answer is "this mode cannot
 * run", not a silent fall back to treasury amounts. Falling back would credit
 * nodes out of the operator's float while the console still claimed the payouts
 * came from swap revenue, which is exactly the lie the mode switch exists to
 * prevent.
 */
export function modeAvailability(mode: DistMode): ModeRefusal | null {
  if (mode !== "swaps") return null;
  return {
    reason: "mode_unavailable",
    message:
      "DIST_MODE is swaps, but there is no swap accrual to read: the hook this mode " +
      "sourced its value from is no longer part of the system. Set DIST_MODE=treasury " +
      "to credit from the distributor float, or leave distribution switched off.",
    detail: {mode},
  };
}

/* ------------------------------------------------------------------- rails */

export type RailReason = "insolvent" | "daily_cap" | "distributor_float";

export type RailInput = {
  /** Sum of the amounts this pass would credit. */
  totalWei: bigint;
  nodeCount: number;

  /** Rolling 24 hour total already credited, from the `credits` table. */
  credited24hWei: bigint;
  dailyCapWei: bigint;

  /** ETH the factory holds right now. */
  contractBalanceWei: bigint;
  /** Sum of every live node balance: what holders are already owed. */
  outstandingWei: bigint;

  /** ETH the distributor account holds. It pays both the value and the gas. */
  distributorBalanceWei: bigint;
  /** Gas the batch is expected to cost, with headroom. */
  gasMarginWei: bigint;
};

/**
 * The three conditions that stop a pass. Order matters: the solvency check
 * comes first because it is the only one that describes money already owed.
 */
export function checkRails(input: RailInput): Refusal<RailReason> | null {
  // Being unable to cover existing obligations is worse than missing a tick.
  // If the contract cannot pay what it already owes, adding to the obligation
  // is the last thing to do, whatever the schedule says.
  //
  // Note this is a check on the state before the pass, not after it. It does
  // not need an "after" form: creditBatch is payable and carries its own value,
  // so `balance` and `outstanding` rise by exactly the same amount and a credit
  // can never move a solvent contract into deficit.
  if (input.contractBalanceWei < input.outstandingWei) {
    return {
      reason: "insolvent",
      message:
        `The contract holds ${formatEthLabel(input.contractBalanceWei)} against ` +
        `${formatEthLabel(input.outstandingWei)} already owed to node holders. ` +
        "Crediting is held until it is funded.",
      detail: {
        balance: input.contractBalanceWei.toString(),
        outstanding: input.outstandingWei.toString(),
        shortfall: (input.outstandingWei - input.contractBalanceWei).toString(),
      },
    };
  }

  // A fuse, not an operating limit. It exists so a mistake in the amount range
  // or the schedule costs one day's budget instead of the whole float.
  const wouldReach = input.credited24hWei + input.totalWei;
  if (wouldReach > input.dailyCapWei) {
    return {
      reason: "daily_cap",
      message:
        `Rolling 24h total would reach ${formatEthLabel(wouldReach)}, past the ` +
        `${formatEthLabel(input.dailyCapWei)} cap.`,
      detail: {
        credited24h: input.credited24hWei.toString(),
        pass: input.totalWei.toString(),
        cap: input.dailyCapWei.toString(),
      },
    };
  }

  // creditBatch sends the credited value with the call, so the distributor pays
  // the amounts and the gas out of the same balance. Sending anyway would burn
  // the gas on a transaction that cannot succeed.
  const needed = input.totalWei + input.gasMarginWei;
  if (input.distributorBalanceWei < needed) {
    return {
      reason: "distributor_float",
      message:
        `The distributor holds ${formatEthLabel(input.distributorBalanceWei)}, short of the ` +
        `${formatEthLabel(needed)} this pass needs (${formatEthLabel(input.totalWei)} credited ` +
        `plus ${formatEthLabel(input.gasMarginWei)} for gas).`,
      detail: {
        balance: input.distributorBalanceWei.toString(),
        pass: input.totalWei.toString(),
        gasMargin: input.gasMarginWei.toString(),
        nodes: input.nodeCount,
      },
    };
  }

  return null;
}

/* --------------------------------------------------------------------- gas */

/**
 * Upper bound on what `creditBatch` costs in gas.
 *
 * Deliberately an over-estimate rather than an `eth_estimateGas` call. The
 * estimate is only used to decide whether to attempt the transaction at all, so
 * being wrong high costs a skipped pass that the next tick retries, while being
 * wrong low costs a transaction that runs out of funds mid-flight. It also
 * cannot be measured honestly before the batch exists: estimating with a value
 * the account cannot afford fails on the node with an unhelpful error.
 *
 * Per node the contract does one cold SLOAD of the node struct, one SSTORE over
 * a non-zero slot, a warm second write to the same slot, one event and two
 * words of calldata: around 10k. 15k covers that with room, and 60k covers the
 * call overhead and the two totals updated at the end.
 *
 * The headroom is deliberately not larger. Refusing costs a pass that will keep
 * refusing on the same numbers until someone funds the account, so a margin far
 * above the real cost would stop payouts on an account that could afford them.
 * The last word belongs to the `simulateContract` step inside `creditBatch`,
 * which refuses to send a transaction that cannot succeed.
 */
const GAS_PER_NODE = 15_000n;
const GAS_OVERHEAD = 60_000n;
/** Doubled so a gas price that moves between the estimate and the send is absorbed. */
const GAS_SAFETY_FACTOR = 2n;

export function gasMarginWei(nodeCount: number, gasPriceWei: bigint): bigint {
  const gas = GAS_OVERHEAD + GAS_PER_NODE * BigInt(nodeCount);
  return gas * gasPriceWei * GAS_SAFETY_FACTOR;
}
