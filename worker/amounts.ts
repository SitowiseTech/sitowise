/**
 * Amount arithmetic for the distribution loop. Pure functions, no I/O, so the
 * one part of the worker that decides how much money moves can be reasoned
 * about on its own.
 */

import {randomBytes, randomInt} from "node:crypto";

/** crypto.randomInt refuses a range wider than 2^48. */
const RANDOM_INT_MAX_SPAN = 2n ** 48n;

/**
 * Uniform integer in [min, max] from the CSPRNG.
 *
 * The configured amounts (2e12 to 1e13 wei by default) fit crypto.randomInt
 * comfortably, so that is the normal path. The rejection-sampling fallback
 * exists because the range comes from configuration and nothing stops an
 * operator setting it to whole ETH, where the range no longer fits a double.
 */
export function randomWei(min: bigint, max: bigint): bigint {
  if (max < min) throw new Error(`randomWei: max (${max}) is below min (${min})`);
  const span = max - min + 1n;
  if (span === 1n) return min;
  if (span <= RANDOM_INT_MAX_SPAN) return min + BigInt(randomInt(0, Number(span)));
  return min + randomBelow(span);
}

/** Uniform bigint in [0, span). Rejects out-of-range draws rather than taking a modulo, which would bias the low end. */
function randomBelow(span: bigint): bigint {
  const bits = span.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  for (;;) {
    const draw = BigInt(`0x${randomBytes(bytes).toString("hex")}`) & mask;
    if (draw < span) return draw;
  }
}

/** Whole seconds in [min, max], inclusive. */
export function randomDelaySec(min: number, max: number): number {
  if (max <= min) return min;
  return randomInt(min, max + 1);
}

export function sum(values: readonly bigint[]): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}
