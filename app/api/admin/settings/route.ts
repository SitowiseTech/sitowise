/**
 * Runtime distribution settings (spec 14's toggles and fields).
 *
 * Writes land in the `settings` table, not in the environment: the worker is a
 * separate process and often a separate host, so nothing a request handler puts
 * in `process.env` would ever reach it. Amounts arrive as wei strings so a
 * value cannot change meaning by passing through a float.
 */

import {forbidden, isAdminRequest, adminConfigured, notFound, unavailable} from "@/lib/admin";
import type {DistConfig} from "@/lib/env";
import {
  clearSettings,
  decodeField,
  isDistField,
  loadSettings,
  saveSettings,
  validateConfig,
  type DistField,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({error: "Send a JSON object of settings."}, {status: 400});
  }

  // Reset drops the stored rows so every field falls back to its env value.
  if (body.reset === true) {
    try {
      await clearSettings();
      const settings = await loadSettings();
      return Response.json({ok: true, overridden: settings.overridden});
    } catch (err) {
      return unavailable(err);
    }
  }

  const patch: Partial<DistConfig> = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!isDistField(key)) {
      return Response.json({error: `Unknown setting "${key}".`}, {status: 400});
    }
    if (typeof raw !== "string") {
      return Response.json({error: `Setting "${key}" must be sent as a string.`}, {status: 400});
    }
    try {
      // The cast is safe: decodeField returns the type belonging to this field.
      (patch as Record<DistField, unknown>)[key] = decodeField(key, raw);
    } catch (err) {
      return Response.json({error: `Setting "${key}": ${(err as Error).message}`}, {status: 400});
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({error: "Nothing to change."}, {status: 400});
  }

  try {
    // Validate the config the worker would end up with, not the patch alone: a
    // new minimum can be fine on its own and still invert the existing range.
    const current = await loadSettings();
    const merged: DistConfig = {...current.config, ...patch};
    const problem = validateConfig(merged);
    if (problem) return Response.json({error: problem}, {status: 400});

    await saveSettings(patch, "admin");
    const settings = await loadSettings();
    return Response.json({ok: true, overridden: settings.overridden});
  } catch (err) {
    return unavailable(err);
  }
}
