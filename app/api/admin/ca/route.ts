/**
 * Publish or unpublish the token address. Behind the admin gate.
 *
 * This is the launch-moment endpoint, so it does as little as possible: one
 * validated write, no build, no deploy.
 */

import {revalidateTag} from "next/cache";
import {adminConfigured, forbidden, isAdminRequest, notFound, unavailable} from "@/lib/admin";
import {CA_TAG, clearTokenCa, readTokenCa, TokenError, writeTokenCa} from "@/lib/token";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();
  try {
    return Response.json({ca: await readTokenCa()});
  } catch (err) {
    return unavailable(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  const body = (await req.json().catch(() => null)) as {ca?: unknown} | null;
  const candidate = typeof body?.ca === "string" ? body.ca : "";

  try {
    const ca = await writeTokenCa(candidate, "admin");
    revalidateTag(CA_TAG, {expire: 0});
    return Response.json({ok: true, ca});
  } catch (err) {
    if (err instanceof TokenError) {
      return Response.json({error: err.message}, {status: 400});
    }
    return unavailable(err);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();
  try {
    await clearTokenCa();
    revalidateTag(CA_TAG, {expire: 0});
    return Response.json({ok: true});
  } catch (err) {
    return unavailable(err);
  }
}
