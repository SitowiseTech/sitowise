/** Wei/ETH formatting. Balances render with 6 decimals per the spec. */

export const WEI_PER_ETH = 10n ** 18n;

/** Format wei as a fixed-decimal ETH string. Truncates, never rounds up. */
export function formatEth(wei: bigint | string, decimals = 6): string {
  const v = typeof wei === "string" ? BigInt(wei || "0") : wei;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / WEI_PER_ETH;
  const frac = abs % WEI_PER_ETH;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals);
  const body = decimals > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${body}` : body;
}

/** `0.000042 ETH` */
export function formatEthLabel(wei: bigint | string, decimals = 6): string {
  return `${formatEth(wei, decimals)} ETH`;
}

/** Parse a decimal ETH string into wei. Throws on malformed input. */
export function parseEth(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error("Enter a valid amount");
  }
  const [whole, frac = ""] = trimmed.split(".");
  const fracPadded = frac.padEnd(18, "0").slice(0, 18);
  return BigInt(whole || "0") * WEI_PER_ETH + BigInt(fracPadded || "0");
}

/** USD value of a wei amount, or null when no price is known. */
export function usdOf(wei: bigint | string, ethUsd: number | null): string | null {
  if (ethUsd == null) return null;
  const v = typeof wei === "string" ? BigInt(wei || "0") : wei;
  const eth = Number(v) / 1e18;
  const usd = eth * ethUsd;
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return usd.toLocaleString("en-US", {style: "currency", currency: "USD"});
}

/** `0x1234…abcd` */
export function shortAddress(addr: string, lead = 6, tail = 4): string {
  if (!addr || addr.length < lead + tail + 2) return addr ?? "";
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

/** Node ids render zero-padded: 1 -> `#0001`. */
export function nodeLabel(id: number | bigint | string): string {
  return `#${String(id).padStart(4, "0")}`;
}

export function isAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** `12 Jan 2026` */
export function formatDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"});
}

/** Relative time for the activity feed: `4m ago`. */
export function timeAgo(iso: string | Date, now: Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const secs = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d);
}
