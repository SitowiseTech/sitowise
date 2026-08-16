import Link from "next/link";
import {ArrowRightIcon} from "@/components/icons";
import {Reveal} from "@/components/Reveal";

/**
 * The banner above the hero (spec 4.1). The reference draws its colour field
 * on a canvas; `.wash` in globals.css paints the same thing in CSS, masked so
 * it stays out of the way of the sentence.
 */

export function AnnounceBanner() {
  return (
    <Reveal className="shell mt-[22px]">
      <Link
        href="/docs"
        className="wash group flex min-h-[66px] items-center gap-3 rounded-[var(--radius-lg)] border border-line-dark px-4 py-3.5 sm:gap-4 sm:px-[22px]"
      >
        <span className="shrink-0 rounded-sharp bg-ink px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-paper-bright">
          New
        </span>
        <span className="min-w-0 text-[14px] leading-[1.4] sm:text-[15px]">
          <strong className="font-bold">Sitowise is live on Robinhood Chain.</strong>{" "}
          Read how balances are held and paid.
        </span>
        <ArrowRightIcon
          size={16}
          className="ml-auto hidden shrink-0 transition-transform duration-200 group-hover:translate-x-1 sm:block"
        />
      </Link>
    </Reveal>
  );
}
