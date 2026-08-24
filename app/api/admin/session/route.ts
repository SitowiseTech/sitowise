/**
 * Exchange ADMIN_KEY for the admin cookie.
 *
 * A browser cannot put `x-admin-key` on a navigation, so the console posts the
 * key here once and works from the cookie afterwards. Rate limited because this
 * is the one admin endpoint that accepts a guess.
 */

import {checkKey, clearAdminCookie, adminConfigured, issueAdminCookie, notFound} from "@/lib/admin";
import {limitByIp, rateLimitHeaders, tooManyRequests} from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();

  const limit = limitByIp(req, "admin-session", {limit: 10, windowMs: 60_000});
  if (!limit.ok) return tooManyRequests(limit);

  const body = (await req.json().catch(() => null)) as {key?: unknown} | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) return Response.json({error: "Enter the admin key."}, {status: 400});

  if (!checkKey(key)) {
    return Response.json({error: "That key is not correct."}, {status: 401, headers: rateLimitHeaders(limit)});
  }

  await issueAdminCookie();
  return Response.json({ok: true});
}

export async function DELETE(): Promise<Response> {
  await clearAdminCookie();
  return Response.json({ok: true});
}
