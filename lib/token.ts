/**
 * The token contract address, published in the site header.
 *
 * This deliberately does NOT live in an environment variable. `NEXT_PUBLIC_*`
 * is inlined at build time, so publishing the address that way would mean a
 * rebuild and a redeploy at the exact moment of a launch, which is the worst
 * possible time to be waiting on a build. It lives in `settings` instead, so
 * saving it in the console puts it on the site within seconds.
 *
 * Until it is set, the header says "soon" rather than showing a placeholder
 * that could be mistaken for a real address.
 */

import {unstable_cache} from "next/cache";
import {isAddress} from "viem";
import {sql} from "@/lib/db";

export const CA_KEY = "token.ca";

/**
 * Cache tag for the published address.
 *
 * The first version cached this at the CDN with a stale window, and a test
 * showed the site still serving "soon" half a minute after the address was
 * saved. At a launch that is unacceptable, so the read is cached in Next's data
 * cache instead and the write invalidates it by tag: no database hit per page
 * view, and no staleness at all after a save.
 */
export const CA_TAG = "token-ca";

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/** Uncached read. Use `cachedTokenCa` on the request path. */
export async function readTokenCa(): Promise<`0x${string}` | null> {
  const rows = await sql<{value: string}>`
    select value from settings where key = ${CA_KEY}
  `;
  const raw = rows[0]?.value?.trim();
  if (!raw) return null;
  // A malformed row must not reach the header: better to say "soon" than to
  // publish something a reader would paste into a wallet.
  if (!isAddress(raw)) return null;
  return raw as `0x${string}`;
}

/**
 * Publish an address.
 *
 * Checksums are not required from the operator, but the value is stored exactly
 * as given after validation, because that is the string people will compare
 * against a block explorer character by character.
 */
export async function writeTokenCa(candidate: string, actor: string): Promise<`0x${string}`> {
  const value = candidate.trim();
  if (!value) throw new TokenError("Paste the contract address first.");
  if (!isAddress(value)) {
    throw new TokenError("That is not a valid contract address.");
  }

  await sql`
    insert into settings (key, value, updated_by)
    values (${CA_KEY}, ${value}, ${actor})
    on conflict (key) do update
      set value = excluded.value,
          updated_by = excluded.updated_by,
          updated_at = now()
  `;
  return value as `0x${string}`;
}

/** Unpublish. The header goes back to "soon". */
export async function clearTokenCa(): Promise<void> {
  await sql`delete from settings where key = ${CA_KEY}`;
}

/** The read the public route uses: cached, and invalidated the moment it changes. */
export const cachedTokenCa = unstable_cache(
  async () => readTokenCa(),
  ["token-ca"],
  // Belt and braces. The tag is what makes a save appear immediately; the three
  // second ceiling is what keeps the delay tiny even if tag invalidation ever
  // fails to reach an instance. Either way the database sees at most one read
  // every few seconds instead of one per page view.
  {tags: [CA_TAG], revalidate: 3},
);
