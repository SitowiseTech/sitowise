/**
 * Settings that only a long-running process has any use for.
 *
 * The distribution numbers are not here. They live in lib/env.ts and can be
 * overridden from /admin at runtime (lib/settings.ts), because a web page has
 * to be able to stop a payout without a redeploy. What is left is the shape of
 * the loop itself: how often it wakes, and how often it says it is alive.
 */

import "@/worker/loadEnv";
import {distTickSec} from "@/lib/env";

export type WorkerConfig = {
  /** Seconds between credit passes. DIST_TICK_SEC. */
  tickSec: number;
  /**
   * How often the sleep looks for an /admin "distribute now". Short enough that
   * the button feels immediate, long enough that an idle worker is not a
   * database poll loop.
   */
  pollMs: number;
  /**
   * Heartbeat cadence during a sleep. Stall detection reads the heartbeat, so
   * it has to move faster than the staleness threshold or a healthy worker with
   * a long interval would look dead.
   */
  heartbeatMs: number;
};

export function workerConfig(): WorkerConfig {
  return {
    tickSec: distTickSec(),
    pollMs: 3_000,
    heartbeatMs: 60_000,
  };
}
