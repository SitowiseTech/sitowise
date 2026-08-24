/**
 * Worker liveness, for a machine rather than a person (spec 8.4: "alert if the
 * worker has not run for more than 15 minutes").
 *
 * Returns 503 once the heartbeat is that old, so an uptime monitor pointed at
 * this URL with the admin key in a header pages someone without anybody having
 * to watch the console.
 */

import {openAlerts} from "@/lib/alerts";
import {forbidden, isAdminRequest, adminConfigured, notFound} from "@/lib/admin";
import {WORKER_STALL_SEC} from "@/lib/settings";
import {isStalled, readWorkerState, silentFor} from "@/lib/workerState";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  let state: Awaited<ReturnType<typeof readWorkerState>>;
  let alerts: Awaited<ReturnType<typeof openAlerts>>;
  try {
    [state, alerts] = await Promise.all([readWorkerState(), openAlerts()]);
  } catch (err) {
    // The monitor should page on an unreadable database too, so this is 503
    // with the reason rather than a stack trace.
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return Response.json({ok: false, error: reason}, {status: 503});
  }

  const silentSec = silentFor(state);
  const stalled = isStalled(state);

  const body = {
    ok: !stalled && state?.lastTickAt != null,
    stalled,
    stallAfterSec: WORKER_STALL_SEC,
    silentSec,
    startedAt: state?.startedAt ?? null,
    lastTickAt: state?.lastTickAt ?? null,
    lastRunAt: state?.lastRunAt ?? null,
    nextRunAt: state?.nextRunAt ?? null,
    pausedReason: state?.pausedReason ?? null,
    lastError: state?.lastError ?? null,
    openAlerts: alerts.map((a) => ({kind: a.kind, severity: a.severity, message: a.message})),
  };

  return Response.json(body, {status: body.ok ? 200 : 503});
}
