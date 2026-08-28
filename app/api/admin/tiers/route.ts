/**
 * GET  /api/admin/tiers                                  -> resolved tiers
 * POST /api/admin/tiers  { id, field, value }            -> change one field
 * POST /api/admin/tiers  { reset: true }                 -> back to the defaults
 *
 * Tier settings live in the `settings` table for the same reason the
 * distribution settings do: the worker is a separate process, often on another
 * host, and nothing a request handler puts in `process.env` would ever reach it.
 *
 * Prices are wei strings and holdings are wei strings. A value that would make
 * two tiers share a price is refused here rather than discovered by a buyer
 * whose payment matched the wrong one.
 */

import {
  checkLimit,
  jsonError,
  jsonOk,
  mergeHeaders,
  PRIVATE_CACHE,
  readJsonBody,
  requireAdmin,
  toResponse,
} from "@/lib/api";
import {
  clearTierSettings,
  loadTiers,
  saveTierField,
  totalAllowance,
  TIER_IDS,
  type TierId,
} from "@/lib/tiers";

const FIELDS = ["price_wei", "max_per_wallet", "holding_wei", "payout_bps", "on_sale"] as const;
type Field = (typeof FIELDS)[number];

function serialise(resolved: Awaited<ReturnType<typeof loadTiers>>) {
  return {
    tiers: TIER_IDS.map((id) => ({
      id,
      label: resolved.tiers[id].label,
      priceWei: resolved.tiers[id].priceWei.toString(),
      maxPerWallet: resolved.tiers[id].maxPerWallet,
      holdingWei: resolved.tiers[id].holdingWei.toString(),
      payoutBps: resolved.tiers[id].payoutBps,
      onSale: resolved.tiers[id].onSale,
    })),
    /** The contract's own cap must be at least this, or the tiers cannot all be filled. */
    totalAllowance: totalAllowance(resolved.tiers),
    problems: resolved.problems,
  };
}

export async function GET(req: Request): Promise<Response> {
  const limit = checkLimit(req, "admin-tiers", {limit: 30});
  if (limit.blocked) return limit.blocked;
  try {
    requireAdmin(req);
    return jsonOk(serialise(await loadTiers()), mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "admin-tiers", limit.headers);
  }
}

export async function POST(req: Request): Promise<Response> {
  const limit = checkLimit(req, "admin-tiers-write", {limit: 30});
  if (limit.blocked) return limit.blocked;

  try {
    requireAdmin(req);
    const body = await readJsonBody(req);

    if (body.reset === true) {
      await clearTierSettings();
      return jsonOk(serialise(await loadTiers()), mergeHeaders(limit.headers, PRIVATE_CACHE));
    }

    const id = String(body.id ?? "") as TierId;
    const field = String(body.field ?? "") as Field;
    const value = typeof body.value === "string" ? body.value.trim() : "";

    if (!TIER_IDS.includes(id)) return jsonError("Unknown tier.", 400, limit.headers);
    if (!FIELDS.includes(field)) return jsonError("Unknown field.", 400, limit.headers);
    if (value === "") return jsonError("Send a value.", 400, limit.headers);

    await saveTierField(id, field, value, "admin");

    // Re-resolve and hand back the problems rather than trusting the write: a
    // value that is well formed on its own can still collide with another tier,
    // and the operator has to see that on the same screen they typed it into.
    const resolved = await loadTiers();
    if (resolved.problems.length > 0) {
      return jsonOk(
        {...serialise(resolved), warning: resolved.problems.join(" ")},
        mergeHeaders(limit.headers, PRIVATE_CACHE),
      );
    }
    return jsonOk(serialise(resolved), mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    return toResponse(err, "admin-tiers", limit.headers);
  }
}
