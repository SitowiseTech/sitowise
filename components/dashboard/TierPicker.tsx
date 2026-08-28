"use client";

import {formatEth} from "@/lib/format";
import type {QuotedTier} from "@/lib/apiClient";
import {Skeleton} from "@/components/ui/Skeleton";

/**
 * Choosing what to buy.
 *
 * Tiers above the base one are gated on holding SITOWISE, so a locked row has
 * to say why it is locked and what would unlock it. A control that is simply
 * greyed out with no reason is the thing people open a support ticket about.
 *
 * The accrual difference is shown as a multiple of the base rate rather than as
 * a percentage, an APR or a payback period. Nothing anywhere in this product
 * states a rate of return, because during the launch period the operator funds
 * the payouts and can reduce or stop them, and a number framed as a yield would
 * read as a promise nobody is in a position to make.
 */

function tokens(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  if (whole >= 1_000_000n) return `${(Number(whole) / 1_000_000).toLocaleString("en-US", {maximumFractionDigits: 2})}M`;
  if (whole >= 1_000n) return `${(Number(whole) / 1_000).toLocaleString("en-US", {maximumFractionDigits: 1})}k`;
  return whole.toLocaleString("en-US");
}

function rate(bps: number): string {
  const x = bps / 10_000;
  // One decimal only when it earns its place: "2.4x" but "5x", never "5.0x".
  return `${Number.isInteger(x) ? x : x.toFixed(1)}x base rate`;
}

export type TierPickerProps = {
  tiers: QuotedTier[];
  selected: QuotedTier["id"];
  onSelect: (id: QuotedTier["id"]) => void;
  holdingWei: bigint | null;
  disabled: boolean;
};

export function TierPicker({tiers, selected, onSelect, holdingWei, disabled}: TierPickerProps) {
  if (tiers.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="mono-label">Tier</span>

      <div role="radiogroup" aria-label="Node tier" className="flex flex-col gap-2">
        {tiers.map((tier) => {
          const locked = tier.eligible === false;
          const isSelected = tier.id === selected;

          return (
            <button
              key={tier.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled || locked}
              onClick={() => onSelect(tier.id)}
              className={`flex flex-col gap-1.5 rounded-sharp border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange ${
                isSelected
                  ? "border-ink bg-panel"
                  : locked
                    ? "border-line bg-transparent opacity-60"
                    : "border-line-dark bg-transparent hover:border-ink"
              } ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[15px] font-medium text-ink">{tier.label}</span>
                <span className="tabular text-[15px] text-ink">
                  {formatEth(tier.priceWei, 6)} ETH
                </span>
              </span>

              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-muted">
                {/* Saying "1x base rate" on the base tier is a tautology, and it
                    makes the one line that matters on the tiers above it look
                    like boilerplate rather than a difference. */}
                {tier.payoutBps === 10_000 ? null : (
                  <>
                    <span>{rate(tier.payoutBps)}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>
                  {tier.remaining === null
                    ? `${tier.maxPerWallet} per wallet`
                    : `${tier.remaining} of ${tier.maxPerWallet} left for you`}
                </span>
                {tier.holdingWei > 0n ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>needs {tokens(tier.holdingWei)} SITOWISE</span>
                  </>
                ) : null}
              </span>

              {locked && tier.blockedReason ? (
                <span className="text-[13px] text-red">{tier.blockedReason}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {holdingWei === null ? null : (
        <p className="text-[13px] text-muted">
          This wallet holds {tokens(holdingWei)} SITOWISE. Eligibility is read from the chain when
          your payment is processed, not when you click.
        </p>
      )}
    </div>
  );
}
