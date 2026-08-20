/**
 * POST /api/auth/logout  ->  { ok: true }
 *
 * Clears the session and any half-finished sign-in. Always succeeds: signing
 * out of a session that has already expired is not an error.
 */

import {checkLimit, jsonOk, mergeHeaders, PRIVATE_CACHE, toResponse} from "@/lib/api";
import {clearSession} from "@/lib/session";

export async function POST(req: Request): Promise<Response> {
  const limit = checkLimit(req, "auth-logout", {limit: 30});
  if (limit.blocked) return limit.blocked;

  try {
    await clearSession();
    return jsonOk({ok: true}, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "auth-logout", limit.headers);
  }
}
