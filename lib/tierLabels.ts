/**
 * Tier display names, safe to import from a client component.
 *
 * lib/tiers.ts reaches the database and the chain, so it cannot be pulled into
 * the browser bundle. The labels are the one part the UI needs without any of
 * that, and they live here on their own.
 */
export const TIER_LABEL: Record<string, string> = {
  base: "Base",
  plus: "Plus",
  prime: "Prime",
};
