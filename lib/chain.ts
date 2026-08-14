import {defineChain} from "viem";

/** Robinhood Chain — chain id 4663 (0x1237). */
export const CHAIN_ID = 4663;
export const CHAIN_ID_HEX = "0x1237";

/**
 * `??` is not enough for these. Vercel returns secret-typed variables as EMPTY
 * STRINGS from `vercel env pull`, and an empty string is not `undefined`, so a
 * nullish fallback passes it straight through. That produced a build where the
 * RPC transport had no URL and prerendering a docs page threw, and separately a
 * bundle with a zero factory address. Treat blank as unset.
 */
function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const RPC_URL = envOr(
  process.env.NEXT_PUBLIC_RPC_URL,
  "https://rpc.mainnet.chain.robinhood.com",
);

export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
  rpcUrls: {default: {http: [RPC_URL]}},
  blockExplorers: {default: {name: "Blockscout", url: EXPLORER_URL}},
});

export const FACTORY_ADDRESS = envOr(
  process.env.NEXT_PUBLIC_FACTORY,
  "0x0000000000000000000000000000000000000000",
) as `0x${string}`;

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER_URL}/address/${addr}`;

/** Params for wallet_addEthereumChain when the wallet has never seen 4663. */
export const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "Robinhood Chain",
  nativeCurrency: {name: "Ether", symbol: "ETH", decimals: 18},
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [EXPLORER_URL],
};
