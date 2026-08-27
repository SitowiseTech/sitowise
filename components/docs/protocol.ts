/**
 * On-chain constants the documentation quotes in more than one place.
 *
 * The Uniswap v4 addresses were read off Robinhood Chain, not copied from a
 * deployment guide: the PoolManager is verified on Blockscout under that name,
 * and the v4 PositionManager returns it from `poolManager()`. The CREATE2
 * factory matters because a v4 hook's address encodes its permissions, so the
 * hook has to be deployed to a mined address rather than a sequential one.
 *
 * Nothing here describes a withdrawal. Withdrawals are a direct call from the
 * node owner to the factory, so there is no lifetime, no domain and no
 * signature for the docs to quote: the only source of truth is the ABI in
 * lib/abi.ts and the deployed address in lib/chain.ts.
 */

export const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
export const POSITION_MANAGER = "0x58daec3116aae6D93017bAAea7749052E8a04fA7";
export const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

/** Uniswap v4 reads a hook's permissions from the low 14 bits of its address. */
export const HOOK_FLAG_MASK = "0x3FFF";
/** afterSwap plus afterSwapReturnDelta, the only two flags Sitowise sets. */
export const HOOK_REQUIRED_FLAGS = "0x44";

/**
 * Hook share of the unspecified side, in basis points. `SitowiseHook.sol` is
 * written and tested (13 tests, contracts/test/SitowiseHook.t.sol) but not yet
 * deployed, and no pool names it, so these are the values the contract sets
 * rather than values anything on chain is charging today.
 */
export const DEFAULT_HOOK_SHARE_BPS = 25;
export const MAX_HOOK_SHARE_BPS = 500;

/**
 * `MAX_PER_WALLET_CEILING`, a constant in SitowiseFactory. `maxPerWallet` is an
 * owner setting and starts at 25; this is the value the owner cannot raise it
 * past, and it is bounded because `withdrawAll` loops over every node a wallet
 * owns.
 */
export const MAX_PER_WALLET_CEILING = 100;
