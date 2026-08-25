/**
 * Passkey enrolment and management.
 *
 * Everything here needs an existing admin session: you prove you are the
 * operator with ADMIN_KEY, and only then may you bolt a finger onto the door.
 * Without that rule anybody could enrol their own passkey and walk in.
 */

import {isAdminRequest, adminConfigured, forbidden, notFound, unavailable} from "@/lib/admin";
import {
  deletePasskey,
  listPasskeys,
  PasskeyError,
  randomLabel,
  registrationOptions,
  verifyRegistration,
} from "@/lib/passkeys";
import type {RegistrationResponseJSON} from "@simplewebauthn/server";

export const dynamic = "force-dynamic";

function failed(err: unknown): Response {
  if (err instanceof PasskeyError) {
    return Response.json({error: err.message}, {status: 400});
  }
  return unavailable(err);
}

/** The enrolled passkeys, plus fresh registration options to add another. */
export async function GET(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  const url = new URL(req.url);
  try {
    if (url.searchParams.get("action") === "options") {
      return Response.json({options: await registrationOptions()});
    }
    const keys = await listPasskeys();
    return Response.json({
      passkeys: keys.map((p) => ({
        id: p.id,
        label: p.label,
        createdAt: p.createdAt.toISOString(),
        lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  const body = (await req.json().catch(() => null)) as {
    response?: RegistrationResponseJSON;
    label?: unknown;
  } | null;

  if (!body?.response) {
    return Response.json({error: "No passkey response was sent."}, {status: 400});
  }

  const label =
    typeof body.label === "string" && body.label.trim() ? body.label.trim() : randomLabel();

  try {
    const stored = await verifyRegistration(body.response, label);
    return Response.json({
      ok: true,
      passkey: {id: stored.id, label: stored.label, createdAt: stored.createdAt.toISOString()},
    });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  const body = (await req.json().catch(() => null)) as {id?: unknown} | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({error: "Which passkey?"}, {status: 400});
  }

  try {
    const removed = await deletePasskey(id);
    if (!removed) return Response.json({error: "No such passkey."}, {status: 404});
    return Response.json({ok: true});
  } catch (err) {
    return failed(err);
  }
}
