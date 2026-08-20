/**
 * POST /api/auth/nonce  ->  { nonce, message }
 * GET  /api/auth/nonce  ->  same
 *
 * Step one of wallet sign-in (spec section 10). The nonce also goes into an
 * httpOnly cookie; /api/auth/verify checks the signature against the cookie
 * copy, so a nonce captured from this response is useless in another browser.
 *
 * `message` is the exact text to pass to personal_sign. Sending it rather than
 * letting the client rebuild it means the string can never drift out of step
 * with the one the server verifies against.
 */

import {checkLimit, jsonOk, mergeHeaders, PRIVATE_CACHE, toResponse} from "@/lib/api";
import {newNonce, signInMessage} from "@/lib/session";

export type NonceResponse = {nonce: string; message: string};

async function issue(req: Request): Promise<Response> {
  const limit = checkLimit(req, "auth-nonce", {limit: 20});
  if (limit.blocked) return limit.blocked;

  try {
    const nonce = await newNonce();
    const body: NonceResponse = {nonce, message: signInMessage(nonce)};
    return jsonOk(body, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "auth-nonce", limit.headers);
  }
}

export function POST(req: Request): Promise<Response> {
  return issue(req);
}

export function GET(req: Request): Promise<Response> {
  return issue(req);
}
