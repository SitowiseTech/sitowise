/** Brand strings and navigation, shared by the header, footer and metadata. */

export const SITE = {
  name: "Sitowise",
  domain: "sitowise.xyz",
  /** One line, used as the meta description base and in the footer. */
  tagline: "Node balances that are backed on Robinhood Chain.",
  description:
    "Deploy a node on Robinhood Chain for 0.02 ETH. Every wei credited to a node is a wei held in the contract, readable on chain and withdrawable to any address. During the launch period rewards are funded by Sitowise.",
  x: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/SitowiseTech",
  xHandle: "@SitowiseTech",
} as const;

export type NavLink = {href: string; label: string};

export const NAV_LINKS: readonly NavLink[] = [
  {href: "/#how-it-works", label: "How it works"},
  {href: "/docs", label: "Docs"},
  {href: "/dashboard", label: "Dashboard"},
];

export const FOOTER_LINKS: readonly NavLink[] = [
  {href: "/docs", label: "Docs"},
  {href: "/dashboard", label: "Dashboard"},
  {href: "/ledger", label: "Ledger"},
];

/** The deploy flow lives on the dashboard; one constant so it moves once. */
export const DEPLOY_HREF = "/dashboard";
export const DEPLOY_LABEL = "Deploy a node";

/**
 * Mint price and per-wallet cap as printed in copy. The contract is the source
 * of truth for both; these are the display strings, kept next to the label that
 * concatenates them so a price change touches one file.
 */
export const NODE_PRICE_ETH = "0.02";
export const MAX_NODES_PER_WALLET = 25;
export const DEPLOY_CTA_LABEL = `${DEPLOY_LABEL} · ${NODE_PRICE_ETH} ETH`;

/**
 * The funding disclosure. Phase-one payouts do not come from swap flow and
 * users are paying real ETH, so this sentence ships verbatim in the footer and
 * in the docs rather than being reworded per surface. It leads with who is
 * paying today; the hook is the plan, not the current source, and saying so in
 * that order is what keeps the sentence honest when it is read on its own.
 */
export const FUNDING_NOTE =
  "During the launch period rewards are funded by Sitowise, not by trading volume. The Uniswap v4 hook intended to replace that funding has no pools attached to it yet.";

/** Absolute origin for metadata and OG URLs. Server-side only. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
