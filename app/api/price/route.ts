/**
 * GET /api/price -> { usd: number | null }
 *
 * The dashboard prints a dollar figure beside every ETH amount (spec 5.3), and
 * the only honest source for that is a live quote. It is proxied rather than
 * fetched from the browser so the page keeps working when an extension blocks
 * third-party requests, and so the upstream call is cached once for everyone
 * instead of once per visitor.
 *
 * A missing quote returns null with a 200. There is no fallback price: the UI
 * drops the dollar line rather than showing an invented number.
 */

const SPOT_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";

/** Long enough to be one upstream call per minute, short enough to be current. */
const TTL_SECONDS = 60;

export async function GET(): Promise<Response> {
  const headers = {"cache-control": `public, max-age=${TTL_SECONDS}`};

  try {
    const upstream = await fetch(SPOT_URL, {
      next: {revalidate: TTL_SECONDS},
      signal: AbortSignal.timeout(4_000),
    });
    if (!upstream.ok) return Response.json({usd: null}, {headers});

    const payload: unknown = await upstream.json();
    const amount =
      typeof payload === "object" && payload !== null
        ? (payload as {data?: {amount?: unknown}}).data?.amount
        : undefined;

    const usd = typeof amount === "string" ? Number(amount) : NaN;
    if (!Number.isFinite(usd) || usd <= 0) return Response.json({usd: null}, {headers});

    return Response.json({usd}, {headers});
  } catch {
    // Timeout, DNS, upstream outage: the page simply shows ETH only.
    return Response.json({usd: null}, {headers});
  }
}
