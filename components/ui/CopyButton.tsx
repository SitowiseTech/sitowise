"use client";

import {useEffect, useRef, useState} from "react";
import {CheckIcon, CopyIcon} from "@/components/icons";

/**
 * Copies a value to the clipboard and confirms it in place. Addresses and
 * transaction hashes are the whole reason this exists, so the default label is
 * the icon alone and the accessible name carries the meaning.
 */

const CONFIRM_MS = 1400;

export type CopyButtonProps = {
  value: string;
  /** Accessible name. Also shown when `showLabel` is set. */
  label?: string;
  showLabel?: boolean;
  className?: string;
};

/** execCommand path for insecure origins, where the async clipboard is absent. */
function legacyCopy(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export function CopyButton({
  value,
  label = "Copy",
  showLabel = false,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      ok = legacyCopy(value);
    }
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      className={[
        "inline-flex h-7 items-center gap-[6px] rounded-sharp px-[7px] text-faint transition-colors hover:bg-panel hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {copied ? (
        <CheckIcon size={14} className="text-green" />
      ) : (
        <CopyIcon size={14} />
      )}
      {showLabel ? (
        <span className="font-mono text-[12px]">{copied ? "Copied" : label}</span>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}
