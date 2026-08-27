"use client";

import {usePathname} from "next/navigation";
import {useEffect, useState} from "react";

/**
 * On this page, with scroll spy.
 *
 * The headings are read from the DOM rather than passed down as props: docs
 * pages are server components and threading a table of contents through the
 * layout would mean every page declaring its own headings twice, which drifts
 * the moment someone edits one and forgets the other.
 *
 * Spying is done on scroll rather than with IntersectionObserver. The question
 * being answered is "which heading did I last pass", and an observer answers
 * "which headings are visible" instead: a section taller than the viewport
 * stops intersecting entirely and the highlight jumps back.
 */

type Entry = {id: string; text: string; depth: 2 | 3};

/** Distance below the sticky header at which a heading counts as reached. */
const ACTIVATION_OFFSET = 120;

export function DocsToc() {
  const pathname = usePathname();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const body = document.querySelector("[data-doc-body]");
    if (!body) {
      setEntries([]);
      return;
    }

    const found: Entry[] = [];
    for (const el of body.querySelectorAll<HTMLElement>("h2[id], h3[id]")) {
      found.push({
        id: el.id,
        text: el.dataset.tocLabel ?? el.textContent?.trim() ?? el.id,
        depth: el.tagName === "H3" ? 3 : 2,
      });
    }
    setEntries(found);
    setActive(found[0]?.id ?? "");
  }, [pathname]);

  useEffect(() => {
    if (entries.length === 0) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      let current = entries[0].id;
      for (const entry of entries) {
        const el = document.getElementById(entry.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - ACTIVATION_OFFSET <= 0) current = entry.id;
      }
      // At the very bottom the last heading may never cross the line, and the
      // reader is plainly looking at it.
      const atBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      if (atBottom) current = entries[entries.length - 1].id;
      setActive(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, {passive: true});
    window.addEventListener("resize", onScroll, {passive: true});
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [entries]);

  if (entries.length < 2) return <div aria-hidden />;

  return (
    <nav className="docs-toc" aria-label="On this page">
      <div className="docs-toc-title">On this page</div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              data-active={active === entry.id ? "true" : "false"}
              className={`docs-toc-link${entry.depth === 3 ? " is-child" : ""}`}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
