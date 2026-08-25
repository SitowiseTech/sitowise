/**
 * Sign in with Touch ID.
 *
 * This is the one passkey route that is open, because it is the one that has to
 * work before you are anybody. It is safe to be open: a challenge is worthless
 * without a private key that only the Secure Enclave holds, and the assertion
 * is verified against a public key that was enrolled from an authenticated
 * session. Rate limited anyway, on the same principle as the key exchange.
 */

import {adminConfigured, issueAdminCookie, notFound, unavailable} from "@/lib/admin";
import {authenticationOptions, PasskeyError, verifyAuthentication} from "@/lib/passkeys";
import {limitByIp, rateLimitHeaders, tooManyRequests} from "@/lib/rateLimit";
import type {AuthenticationResponseJSON} from "@simplewebauthn/server";

export const dynamic = "force-dynamic";

function failed(err: unknown): Response {
  if (err instanceof PasskeyError) {
    return Response.json({error: err.message}, {status: 400});
  }
  return unavailable(err);
}

/** Challenge to sign. */
export async function GET(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();

  const limit = limitByIp(req, "admin-passkey", {limit: 20, windowMs: 60_000});
  if (!limit.ok) return tooManyRequests(limit);

  try {
    return Response.json({options: await authenticationOptions()});
  } catch (err) {
    return failed(err);
  }
}

/** Verify the signed challenge and issue the same cookie the key would. */
export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();

  const limit = limitByIp(req, "admin-passkey", {limit: 20, windowMs: 60_000});
  if (!limit.ok) return tooManyRequests(limit);

  const body = (await req.json().catch(() => null)) as {
    response?: AuthenticationResponseJSON;
  } | null;

  if (!body?.response) {
    return Response.json({error: "No passkey response was sent."}, {status: 400});
  }

  try {
    const ok = await verifyAuthentication(body.response);
    if (!ok) {
      return Response.json(
        {error: "That passkey was not accepted."},
        {status: 401, headers: rateLimitHeaders(limit)},
      );
    }
    await issueAdminCookie();
    return Response.json({ok: true});
  } catch (err) {
    return failed(err);
  }
}
