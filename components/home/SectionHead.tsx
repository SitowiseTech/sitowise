import type {ReactNode} from "react";
import {Reveal} from "@/components/Reveal";

/**
 * The rhythm marker every landing section starts with: a hairline, a mono
 * micro-label, the heading, and an optional line of context to its right.
 *
 * It exists so the vertical spacing between sections is decided once. The
 * reference gets its cadence from that repetition, and hand-spacing each
 * section is how a clone drifts out of rhythm.
 */

export type SectionHeadProps = {
  /** Uppercase mono marker, e.g. "HOW IT WORKS". */
  label: string;
  title: ReactNode;
  /** Sits beside the heading on wide screens, under it on narrow ones. */
  aside?: ReactNode;
};

export function SectionHead({label, title, aside}: SectionHeadProps) {
  return (
    <>
      <hr className="rule" />
      <Reveal className="mt-7 flex flex-col gap-6 sm:mt-9 md:flex-row md:items-end md:justify-between md:gap-14">
        <div className="flex flex-col gap-4">
          <p className="mono-label">{label}</p>
          <h2 className="h2 max-w-[18ch] text-balance">{title}</h2>
        </div>
        {aside ? (
          <p className="lede max-w-[44ch] md:pb-1">{aside}</p>
        ) : null}
      </Reveal>
    </>
  );
}
