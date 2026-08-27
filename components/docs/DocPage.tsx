import Link from "next/link";
import type {ReactNode} from "react";
import {adjacentDocs, docByHref, groupOf} from "@/components/docs/nav";
import {ArrowRightIcon} from "@/components/icons";

/**
 * The frame every documentation page renders inside: eyebrow, title, lede,
 * prose, then the pager.
 *
 * `href` is the page's own route. It is passed rather than read from
 * usePathname because these pages are server components and the eyebrow, title
 * and pager all resolve from the same nav tree at render time.
 */

export type DocPageProps = {
  href: string;
  /** Overrides the label in nav.ts when the heading should read longer. */
  title?: string;
  lede: ReactNode;
  children: ReactNode;
};

export function DocPage({href, title, lede, children}: DocPageProps) {
  const entry = docByHref(href);
  const group = groupOf(href);
  const {prev, next} = adjacentDocs(href);
  const heading = title ?? entry?.label ?? "Documentation";

  return (
    <div data-doc-body>
      <header className="mb-9">
        {group ? (
          <div className="doc-eyebrow mono-label mb-4">
            <span className="text-orange">{group.title}</span>
          </div>
        ) : null}
        <h1 className="h1 max-w-[16ch] text-[clamp(34px,4.6vw,50px)] leading-[1.04]">
          {heading}
        </h1>
        <p className="lede mt-5 max-w-[62ch] text-[19px]">{lede}</p>
      </header>

      <div className="doc-prose">{children}</div>

      {prev || next ? (
        <nav className="doc-pager" aria-label="Documentation pages">
          {prev ? (
            <Link href={prev.href} className="doc-pager-link">
              <span className="mono-label">Previous</span>
              <span className="text-[15px] font-medium text-ink">{prev.label}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={next.href} className="doc-pager-link is-next">
              <span className="mono-label">Next</span>
              <span className="inline-flex items-center justify-end gap-2 text-[15px] font-medium text-ink">
                {next.label}
                <ArrowRightIcon size={14} className="text-orange" />
              </span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

/**
 * Table wrapper. Wide tables scroll inside their own box instead of forcing the
 * page to scroll sideways, which is the one layout rule long docs always break.
 */
export function DocTable({children}: {children: ReactNode}) {
  return (
    <div className="doc-table">
      <table>{children}</table>
    </div>
  );
}

/** Figure with a caption, used by every diagram and chart on these pages. */
export function DocFigure({caption, children}: {caption: ReactNode; children: ReactNode}) {
  return (
    <figure className="doc-figure">
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
