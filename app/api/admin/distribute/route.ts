/**
 * "Distribute now" (spec 14).
 *
 * Leaves a flag in worker_state instead of crediting anything here. The worker
 * owns the publisher key and the advisory lock, so it is the only process that
 * may write a distribution; a route that did it directly would credit the
 * ledger with nothing able to publish the matching on-chain checkpoint. The
 * worker picks the flag up within seconds of the request.
 */

import {forbidden, isAdminRequest, adminConfigured, notFound, unavailable} from "@/lib/admin";
import {loadSettings} from "@/lib/settings";
import {isStalled, readWorkerState, requestRunNow} from "@/lib/workerState";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) return notFound();
  if (!(await isAdminRequest(req))) return forbidden();

  try {
    const settings = await loadSettings();
    if (!settings.config.enabled) {
      return Response.json({error: "Distribution is switched off. Turn it on first."}, {status: 409});
    }

    const state = await readWorkerState();
    if (isStalled(state)) {
      return Response.json(
        {error: "The worker has not checked in for over 15 minutes. Start it before asking for a round."},
        {status: 409},
      );
    }

    await requestRunNow();
    return Response.json({ok: true});
  } catch (err) {
    return unavailable(err);
  }
}
