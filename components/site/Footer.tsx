import Link from "next/link";
import {XIcon} from "@/components/icons";
import {Wordmark} from "@/components/site/Wordmark";
import {CHAIN_ID} from "@/lib/chain";
import {FOOTER_LINKS, FUNDING_NOTE, SITE} from "@/lib/site";

/**
 * Closing rail. Carries the funding disclosure on every page, because it is
 * the one thing a visitor should not have to open the docs to find.
 */

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-24 border-t border-line">
      <div className="shell flex flex-col gap-8 py-10">
        {/* Wordmark and the X icon share the first line on narrow screens; the
            nav drops to its own row rather than orphaning the icon. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-5">
          <Link href="/" aria-label={`${SITE.name} home`} className="w-max">
            <Wordmark size="sm" />
          </Link>

          <nav
            aria-label="Footer"
            className="order-3 flex basis-full flex-wrap gap-x-8 gap-y-3 font-mono text-[13px] sm:order-2 sm:basis-auto sm:flex-1 sm:justify-center"
          >
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-muted transition-colors hover:text-orange"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <a
            href={SITE.x}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${SITE.name} on X`}
            className="order-2 flex size-9 items-center justify-center rounded-sharp text-ink transition-colors hover:bg-panel hover:text-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange sm:order-3"
          >
            <XIcon size={26} />
          </a>
        </div>

        <hr className="rule" />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-[620px] text-[13px] leading-[1.6] text-muted">
            {FUNDING_NOTE}
          </p>
          <p className="mono-label shrink-0">
            Robinhood Chain · {CHAIN_ID}
          </p>
        </div>

        <p className="mono-label">
          © {year} {SITE.name}
        </p>
      </div>
    </footer>
  );
}
