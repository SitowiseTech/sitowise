import Image from "next/image";

import {SITE} from "@/lib/site";

/**
 * The Sitowise mark: the logo tile plus the wordmark beside it.
 *
 * The tile carries its own pastel gradient, so it is never tinted or recolored
 * here. It also means the mark must not sit on a busy background: the header
 * and footer both use the flat paper surface for exactly that reason.
 */

export type WordmarkProps = {
  size?: "sm" | "md";
  /** Hide the text and render the tile alone, for tight spots. */
  markOnly?: boolean;
  className?: string;
};

const TILE = {
  // The footer mark is the larger of the two on purpose: it sits in open space
  // with nothing competing for the eye, where the header has to share a 78px
  // strip with the nav and the CTA.
  sm: 44,
  md: 40,
} as const;

const TYPE = {
  sm: "text-[24px]",
  md: "text-[21px]",
} as const;

export function Wordmark({size = "md", markOnly = false, className}: WordmarkProps) {
  const px = TILE[size];

  return (
    <span
      className={[
        "inline-flex items-center gap-[12px] font-sans font-semibold tracking-[-0.02em] text-ink",
        TYPE[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Image
        src="/logo-256.png"
        alt={markOnly ? SITE.name : ""}
        aria-hidden={markOnly ? undefined : true}
        width={px}
        height={px}
        priority
        // The tile's own gradient is nearly as light as the paper background, so
        // its edge disappears. A hairline of ink at low alpha gives it back,
        // inset so the mark keeps the exact box size the layout was built on.
        className="shrink-0 rounded-[9px] ring-1 ring-ink/15 ring-inset"
        style={{width: px, height: px}}
      />
      {!markOnly && SITE.name}
    </span>
  );
}
