/**
 * Access control for /admin (spec 14).
 *
 * Two ways in, because the surface is used two ways. A script or a curl call
 * sends `x-admin-key`; a browser cannot attach a header to a navigation, so it
 * exchanges the key once at /admin for a cookie.
 *
 * The cookie holds a hash of the key, not the key: reading it back off the wire
 * tells an attacker nothing they can send anywhere else, and rotating ADMIN_KEY
 * invalidates every session for free. There is no separate session table
 * because there is one operator and one key.
 *
 * With ADMIN_KEY unset the whole surface behaves as if it does not exist.
 */

import {cookies} from "next/headers";
import {createHash, timingSafeEqual} from "node:crypto";
import {adminKey, hasAdminKey} from "@/lib/env";

export const ADMIN_COOKIE = "sitowise_admin";
export const ADMIN_HEADER = "x-admin-key";

/** Long enough for a working session, short enough to expire over a weekend. */
const ADMIN_TTL_SEC = 12 * 60 * 60;

function cookieToken(): string {
  return createHash("sha256").update(`sitowise-admin:${adminKey()}`).digest("hex");
}

/** Constant-time compare. Only the length is allowed to leak. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** False when ADMIN_KEY is unset: callers should 404 rather than explain. */
export function adminConfigured(): boolean {
  return hasAdminKey();
}

export function checkKey(candidate: string): boolean {
  if (!hasAdminKey()) return false;
  return safeEqual(candidate, adminKey());
}

export async function issueAdminCookie(): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, cookieToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_TTL_SEC,
  });
}

export async function clearAdminCookie(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

/** Cookie only. This is what a page render can check. */
export async function isAdmin(): Promise<boolean> {
  if (!hasAdminKey()) return false;
  const value = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!value) return false;
  try {
    return safeEqual(value, cookieToken());
  } catch {
    return false;
  }
}

/** Header or cookie. This is what a route handler should check. */
export async function isAdminRequest(req: Request): Promise<boolean> {
  if (!hasAdminKey()) return false;
  const header = req.headers.get(ADMIN_HEADER);
  if (header && checkKey(header.trim())) return true;
  return isAdmin();
}

/** The single error shape the rest of the API uses. */
export function forbidden(): Response {
  return Response.json({error: "Not authorised."}, {status: 401});
}

/** Used when ADMIN_KEY is absent, so the route is indistinguishable from a typo. */
export function notFound(): Response {
  return Response.json({error: "Not found."}, {status: 404});
}

/**
 * A dependency the console needs is down. 503 rather than 500, because the
 * request was fine and retrying later is the right response.
 */
export function unavailable(err: unknown): Response {
  const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
  return Response.json({error: reason}, {status: 503});
}
