"use client";

import {useEffect, useState} from "react";

/**
 * The contract address in the header.
 *
 * Reads at runtime rather than at build time, so publishing the address is a
 * save in the console and not a redeploy. Before launch it says "soon", which
 * is honest and is also what stops a placeholder being mistaken for an address.
 *
 * Clicking copies the full address, never the shortened form on screen. The
 * middle of an address is exactly what somebody would need to verify, so a
 * truncated copy would be worse than no copy at all.
 */

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function CaPill({onNavigate}: {onNavigate?: () => void}) {
  const [ca, setCa] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/ca")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: {ca?: string | null} | null) => {
        if (alive && d?.ca) setCa(d.ca);
      })
      .catch(() => {
        // The header must render regardless. "soon" is the safe default.
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    if (!ca) return;
    try {
      await navigator.clipboard.writeText(ca);
      setCopied(true);
    } catch {
      // Clipboard blocked. Selecting the text by hand still works.
    }
    onNavigate?.();
  }

  const label = ca ? (copied ? "Copied" : short(ca)) : "soon";

  return (
    <button
      type="button"
      onClick={copy}
      disabled={!ca}
      title={ca ?? "Not launched yet"}
      aria-label={ca ? `Copy contract address ${ca}` : "Contract address, not launched yet"}
      className={`flex h-9 items-center gap-1.5 rounded-sharp border border-line-dark px-2.5 font-mono text-[12.5px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange ${
        ca ? "cursor-pointer text-ink hover:border-orange hover:text-orange" : "cursor-default text-muted"
      }`}
    >
      <span className="text-faint">CA:</span>
      <span className={copied ? "text-orange" : undefined}>{label}</span>
    </button>
  );
}
