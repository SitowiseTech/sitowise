/**
 * Shared vocabulary for the hero diagram. The labels live here rather than in
 * the painter because the layout has to measure them before anything is drawn.
 *
 * The diagram shows what the contract does today: ETH arrives, and it is
 * assigned to node balances in the same transaction that carries it. The
 * Uniswap v4 hook is the future source of that ETH and is described in the
 * docs, not drawn here, because no pool routes through it yet.
 */

export const INPUTS = ["Credit", "Batch", "Funding", "ETH in"];
export const OUTPUTS = ["Node 01", "Node 02", "Node 03", "Your balance"];
export const HOOK_LABEL = "Sitowise contract";

export const LANES = 4;
/** Retina beyond 2x costs fill rate and buys nothing on a stipple field. */
export const DPR_CAP = 2;
/** Cubic control points: px, py, c0x, c0y, c1x, c1y, qx, qy. */
export const STRIDE = 8;
/** Entries in the arc-length lookup for one curve. */
export const MAP_N = 33;
