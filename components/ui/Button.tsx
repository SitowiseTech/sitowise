"use client";

import Link from "next/link";
import type {MouseEventHandler, ReactNode} from "react";
import {SpinnerIcon} from "@/components/icons";

/**
 * Every button and call to action on the site. Wraps the `.btn` classes from
 * globals.css rather than restating them, so the 44px height and 3px radius
 * stay defined in one place.
 *
 * The prop surface is written out instead of extending the DOM attribute
 * types: the element rendered switches between button, Link and a, and a
 * spread union of those three is worse to consume than an explicit list.
 */

export type ButtonVariant = "dark" | "ghost" | "quiet";
export type ButtonSize = "md" | "sm";

const VARIANT: Record<ButtonVariant, string> = {
  dark: "btn-dark",
  ghost: "btn-ghost",
  quiet: "btn-quiet",
};

/** `sm` is the header rhythm: 36px, matching the reference build. */
const SIZE: Record<ButtonSize, string> = {
  md: "",
  sm: "h-9 px-[18px] text-[13px]",
};

export type ButtonProps = {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Renders a link instead of a button. */
  href?: string;
  /** Force a new tab. Absolute URLs get this for free. */
  external?: boolean;
  /** Swaps the label for a spinner and blocks activation. */
  loading?: boolean;
  disabled?: boolean;
  /** Trailing glyph, typically an arrow. Hidden while loading. */
  trailing?: ReactNode;
  onClick?: MouseEventHandler<HTMLElement>;
  type?: "button" | "submit" | "reset";
  form?: string;
  id?: string;
  title?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: boolean;
};

export function Button({
  children,
  variant = "dark",
  size = "md",
  className,
  href,
  external,
  loading = false,
  disabled = false,
  trailing,
  onClick,
  type = "button",
  form,
  id,
  title,
  autoFocus,
  "aria-label": ariaLabel,
  "aria-controls": ariaControls,
  "aria-expanded": ariaExpanded,
  "aria-haspopup": ariaHasPopup,
}: ButtonProps) {
  const inert = disabled || loading;
  const cls = ["btn", VARIANT[variant], SIZE[size], className]
    .filter(Boolean)
    .join(" ");

  const label = (
    <>
      {loading ? <SpinnerIcon size={15} /> : null}
      <span>{children}</span>
      {!loading && trailing ? trailing : null}
    </>
  );

  const shared = {
    id,
    title,
    className: cls,
    "aria-label": ariaLabel,
    "aria-controls": ariaControls,
    "aria-expanded": ariaExpanded,
    "aria-haspopup": ariaHasPopup,
  };

  if (href !== undefined) {
    // A disabled anchor has no native equivalent, so drop the href entirely
    // rather than leaving a live link that only looks inert.
    if (inert) {
      return (
        <span {...shared} role="link" aria-disabled="true">
          {label}
        </span>
      );
    }
    if (external ?? /^(https?:)?\/\//.test(href)) {
      return (
        <a
          {...shared}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={onClick}
        >
          {label}
        </a>
      );
    }
    return (
      <Link {...shared} href={href} onClick={onClick}>
        {label}
      </Link>
    );
  }

  return (
    <button
      {...shared}
      type={type}
      form={form}
      autoFocus={autoFocus}
      disabled={inert}
      aria-busy={loading || undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
