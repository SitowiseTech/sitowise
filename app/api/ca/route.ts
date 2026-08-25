/**
 * The published token address, for the header.
 *
 * Public and unauthenticated: this is the one number the whole internet is
 * meant to read. Cached for a few seconds at the edge so a launch-day crowd
 * does not turn every page view into a database round trip, while still
 * appearing within seconds of being saved in the console.
 */

import {dbConfigured} from "@/lib/db";
import {cachedTokenCa} from "@/lib/token";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // No database configured is not an error here. The header simply says "soon".
  if (!dbConfigured()) {
    return Response.json({ca: null}, {headers: {"cache-control": "no-store"}});
  }

  try {
    const ca = await cachedTokenCa();
    return Response.json(
      {ca},
      {
        // No CDN caching on purpose. The database read behind this is already
        // cached and tag-invalidated, so this costs nothing per request, and a
        // CDN copy would reintroduce exactly the staleness that cache removes.
        headers: {"cache-control": "no-store"},
      },
    );
  } catch {
    // A database problem must never break the header on every page.
    return Response.json({ca: null}, {headers: {"cache-control": "no-store"}});
  }
}
