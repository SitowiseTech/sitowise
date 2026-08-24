/** Close one alert from the console. */

import {resolveAlertById} from "@/lib/alerts";
import {forbidden, isAdminRequest, adminConfigured, notFound, unavailable} from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  const body = (await req.json().catch(() => null)) as {id?: unknown} | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({error: "Send the alert id."}, {status: 400});
  }

  try {
    const resolved = await resolveAlertById(id);
    if (!resolved) return Response.json({error: "That alert is already closed."}, {status: 409});
    return Response.json({ok: true});
  } catch (err) {
    return unavailable(err);
  }
}
