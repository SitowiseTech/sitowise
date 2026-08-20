/**
 * POST /api/auth/verify  { address, signature }  ->  { address }
 *
 * Step two of wallet sign-in. The address in the body is not a claim of
 * identity on its own: it is only accepted because the signature over this
 * browser's nonce recovers to it. Every route after this one reads the address
 * from the session cookie instead, never from a body.
 */

import {
  checkLimit,
  jsonOk,
  mergeHeaders,
  parseAddressField,
  PRIVATE_CACHE,
  readJsonBody,
  toResponse,
} from "@/lib/api";
import {sql} from "@/lib/db";
import {SessionError, verifyAndIssue} from "@/lib/session";

export type VerifyResponse = {address: string};

export async function POST(req: Request): Promise<Response> {
  const limit = checkLimit(req, "auth-verify", {limit: 20});
  if (limit.blocked) return limit.blocked;

  try {
    const body = await readJsonBody(req);
    const address = parseAddressField(body.address, "address");
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    if (signature === "") throw new SessionError("A wallet signature is required.");

    const verified = await verifyAndIssue(address, signature);

    // The session cookie is already set by this point. If the ledger is
    // unreachable the sign-in is still genuine, and reporting failure would
    // leave the browser signed in while telling the user it is not. The row is
    // bookkeeping; /api/nodes/sync recreates it before it inserts a node.
    try {
      await sql`
        insert into wallets (address, last_login_at) values (${verified}, now())
        on conflict (address) do update set last_login_at = now()
      `;
    } catch (err) {
      console.error("[api:auth-verify] could not record the login:", err);
    }

    const payload: VerifyResponse = {address: verified};
    return jsonOk(payload, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "auth-verify", limit.headers);
  }
}
