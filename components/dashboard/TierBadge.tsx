import {TIER_LABEL} from "@/lib/tierLabels";

/**
 * Which tier a node was bought at.
 *
 * Deliberately quiet: a small outlined label, not a coloured pill. Every node
 * in the list is the same kind of object and behaves identically; the tier
 * changes what it cost and how fast it accrues, and dressing the higher ones up
 * would turn a fact into an advertisement on a page people open to check their
 * own money.
 */
export function TierBadge({tier}: {tier: string}) {
  const label = TIER_LABEL[tier] ?? TIER_LABEL.base;
  // The base tier is the default and needs no label; marking it would put a
  // badge on every row and stop the badge meaning anything.
  if (tier === "base" || !TIER_LABEL[tier]) return null;

  return (
    <span className="mono-label shrink-0 rounded-sharp border border-line-dark px-1.5 py-0.5 text-ink">
      {label}
    </span>
  );
}
