import Link from "next/link";
import type {CSSProperties} from "react";
import {DOC_NAV, type DocLink} from "@/components/docs/nav";
import {ArrowRightIcon} from "@/components/icons";

/** The stagger custom property read by the [data-reveal] rules in globals.css. */
type RevealStyle = CSSProperties & {"--reveal-delay"?: string};

/**
 * Index cards for a set of documentation groups. Used on the overview so the
 * first page is a map of the section rather than a wall of prose with the real
 * navigation hidden in a sidebar the reader has not looked at yet.
 */

export function DocCards({items}: {items: readonly DocLink[]}) {
  return (
    <div className="mb-7 grid gap-3 sm:grid-cols-2">
      {items.map((item, i) => {
        // Declared, not inlined: an object literal with a custom property in it
        // trips the excess-property check against CSSProperties.
        const style: RevealStyle | undefined =
          i > 0 ? {"--reveal-delay": `${i * 60}ms`} : undefined;

        return (
        <Link
          key={item.href}
          href={item.href}
          data-reveal="panel"
          className="panel group grid content-start gap-2 p-4 transition-colors hover:border-line-dark sm:p-5"
          style={style}
        >
          <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            {item.label}
            <ArrowRightIcon
              size={14}
              className="text-faint transition-colors group-hover:text-orange"
            />
          </span>
          <span className="text-[13.5px] leading-[1.5] text-muted">{item.blurb}</span>
        </Link>
        );
      })}
    </div>
  );
}

export function DocIndex({groups}: {groups: readonly string[]}) {
  const selected = DOC_NAV.filter((group) => groups.includes(group.title));

  return (
    <>
      {selected.map((group) => (
        <section key={group.title}>
          <h3>{group.title}</h3>
          <DocCards items={group.items} />
        </section>
      ))}
    </>
  );
}
