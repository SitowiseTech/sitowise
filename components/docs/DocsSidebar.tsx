"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useId, useState} from "react";
import {DOC_NAV, docByHref} from "@/components/docs/nav";
import {ArrowRightIcon, CloseIcon, MenuIcon} from "@/components/icons";

/**
 * The documentation index.
 *
 * Below 1024px the sidebar becomes a disclosure so the page opens on its own
 * content instead of on a thirty-item list. The same markup serves both, which
 * keeps one source of active state rather than two lists that can disagree.
 */

function isCurrent(pathname: string, href: string): boolean {
  // /docs is the Overview page, so it must match exactly; every other entry is
  // a leaf too, but comparing exactly keeps /docs/api from lighting up while
  // the reader is on /docs/api/errors.
  return pathname === href;
}

export function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Navigating from the mobile disclosure must close it, or the reader lands
  // behind the menu they just used.
  useEffect(() => setOpen(false), [pathname]);

  const current = docByHref(pathname);

  return (
    <aside className="docs-side" aria-label="Documentation">
      <div className="flex items-center justify-between gap-4 lg:hidden">
        <div className="min-w-0">
          <div className="mono-label">Docs</div>
          <div className="truncate font-mono text-[13px] text-ink">
            {current?.label ?? "Overview"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="inline-flex h-9 items-center gap-2 rounded-sharp border border-line-dark px-3 font-mono text-[12px] text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
        >
          {open ? <CloseIcon size={14} /> : <MenuIcon size={14} />}
          {open ? "Close" : "All pages"}
        </button>
      </div>

      <nav
        id={panelId}
        className={`${open ? "mt-5 block" : "hidden"} lg:mt-0 lg:block`}
        aria-label="Documentation sections"
      >
        {DOC_NAV.map((group) => (
          <div key={group.title} className="docs-side-group">
            <div className="docs-side-title">{group.title}</div>
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="docs-side-link"
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="mt-8 border-t border-line pt-5">
          <Link
            href="/dashboard"
            className="docs-side-link !pl-4 !text-ink hover:!bg-panel"
          >
            Open the dashboard
            <ArrowRightIcon size={13} className="ml-2 text-faint" />
          </Link>
        </div>
      </nav>
    </aside>
  );
}
