"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useCallback, useEffect, useId, useRef, useState} from "react";
import {GitHubIcon, MenuIcon, XIcon} from "@/components/icons";
import {CaPill} from "@/components/site/CaPill";
import {Wordmark} from "@/components/site/Wordmark";
import {Button} from "@/components/ui/Button";
import {DEPLOY_HREF, DEPLOY_LABEL, NAV_LINKS, SITE} from "@/lib/site";

/**
 * Sticky 78px header on a translucent blur, hairline underneath. Three
 * columns on desktop, collapsing to wordmark plus a menu disclosure below
 * 900px, which is where the centre nav stops fitting beside the actions.
 */

function isActive(pathname: string, href: string): boolean {
  const path = href.split("#")[0];
  if (path === "/" || path === "") return false;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // A menu that survives navigation would cover the page it just opened.
  useEffect(() => close(), [pathname, close]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
      trigger.current?.querySelector("button")?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      close();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  return (
    <header className="sticky top-0 z-50 h-[var(--header-h)] border-b border-line bg-paper/90 backdrop-blur-[12px]">
      <div className="shell grid h-full grid-cols-[1fr_auto] items-center gap-7 min-[900px]:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Link href="/" aria-label={`${SITE.name} home`} className="w-max">
          <Wordmark />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden justify-center gap-[clamp(16px,2.4vw,42px)] font-mono text-[13px] min-[900px]:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              className={`transition-colors hover:text-orange ${
                isActive(pathname, link.href) ? "text-orange" : "text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3.5 justify-self-end min-[900px]:flex">
          <CaPill />
          <a
            href={SITE.x}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${SITE.name} on X`}
            className="flex size-9 items-center justify-center rounded-sharp text-ink transition-colors hover:bg-panel hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            <XIcon size={22} />
          </a>
          <a
            href={SITE.github}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${SITE.name} on GitHub`}
            className="flex size-9 items-center justify-center rounded-sharp text-ink transition-colors hover:bg-panel hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            {/* Two down on the X. The mark is a filled disc against the X's
                thin diagonals, so matching the box would outweigh it. */}
            <GitHubIcon size={20} />
          </a>
          <Button href={DEPLOY_HREF} size="sm" className="min-w-[142px] justify-center">
            {DEPLOY_LABEL}
          </Button>
        </div>

        <div ref={trigger} className="relative justify-self-end min-[900px]:hidden">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={menuId}
            aria-haspopup="menu"
            className="flex h-9 items-center gap-2 rounded-sharp px-2 font-mono text-[13px] text-ink transition-colors hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
          >
            <MenuIcon size={16} />
            Menu
          </button>

          {open ? (
            <div
              ref={panel}
              id={menuId}
              className="absolute top-[38px] right-0 z-10 grid w-[224px] gap-4 rounded-sharp border border-line-dark bg-paper-bright p-5 shadow-[0_18px_40px_rgba(22,23,20,0.12)]"
            >
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  aria-current={isActive(pathname, link.href) ? "page" : undefined}
                  className="font-mono text-[13px] text-ink transition-colors hover:text-orange"
                >
                  {link.label}
                </Link>
              ))}
              <CaPill onNavigate={close} />
              <a
                href={SITE.x}
                target="_blank"
                rel="noreferrer noopener"
                onClick={close}
                className="inline-flex items-center gap-2 font-mono text-[13px] text-ink transition-colors hover:text-orange"
              >
                <XIcon size={18} />
                {SITE.xHandle}
              </a>
              <a
                href={SITE.github}
                target="_blank"
                rel="noreferrer noopener"
                onClick={close}
                className="inline-flex items-center gap-2 font-mono text-[13px] text-ink transition-colors hover:text-orange"
              >
                <GitHubIcon size={18} />
                GitHub
              </a>
              <Button
                href={DEPLOY_HREF}
                size="sm"
                onClick={close}
                className="justify-center"
              >
                {DEPLOY_LABEL}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
