/**
 * POST /api/admin/migrate  { confirm: "run-migrations" }  ->  { applied[] }
 *
 * There is no migration runner in this project: schema changes have been
 * applied by hand against the database. That worked while the changes were
 * rare, and stopped working the moment a deploy needed columns that were not
 * there yet, because the window between shipping the code and running the SQL
 * is a window where every query touching them fails.
 *
 * So the statements live here, and every one of them is idempotent: running
 * this twice is the same as running it once. It is deliberately explicit rather
 * than a directory scan, because a migration that runs itself off disk is one
 * bad file away from doing something nobody reviewed.
 */

import {checkLimit, jsonError, jsonOk, mergeHeaders, PRIVATE_CACHE, readJsonBody, requireAdmin, toResponse} from "@/lib/api";
import {tx} from "@/lib/db";

/** Each entry is one migration: a name, and statements safe to re-run. */
const MIGRATIONS: {name: string; statements: string[]}[] = [
  {
    name: "010_tiers",
    statements: [
      `alter table payments add column if not exists tier text`,
      `alter table nodes add column if not exists tier text not null default 'base'`,
      `create index if not exists nodes_owner_tier_idx on nodes (owner_address, tier)`,
      `create index if not exists payments_from_tier_idx on payments (from_address, tier)`,
      // The view names its columns, so the tier has to be added here too or
      // nothing reading through it can see one.
      `create or replace view node_view as
       select
         n.id, n.chain_node_id, n.owner_address, n.mint_tx_hash, n.price_wei,
         n.status, n.created_at,
         coalesce(c.total, 0) as cumulative_wei,
         coalesce(w.total, 0) as withdrawn_wei,
         greatest(coalesce(c.total, 0) - coalesce(w.total, 0), 0) as balance_wei,
         -- Appended, never inserted: "create or replace view" can only add
         -- columns at the end, and putting one in the middle is read as
         -- renaming whatever already held that position.
         n.tier
       from nodes n
       left join lateral (
         select sum(amount_wei) as total from credits where node_id = n.id
       ) c on true
       left join lateral (
         select sum(amount_wei) as total from withdrawals where node_chain_id = n.chain_node_id
       ) w on true`,
    ],
  },
  {
    name: "011_backfill_node_tiers",
    statements: [
      // Nodes recorded before the payment join was fixed were filed as base at
      // the base price, whatever was actually paid for them. The relay records
      // a node before it marks the payment minted, so the old lookup on
      // `mint_tx_hash` always missed. By now that column is filled in, so it is
      // the right key for the repair even though it was the wrong one for the
      // insert.
      `update nodes n
          set tier = p.tier,
              price_wei = p.amount_wei
         from payments p
        where lower(p.mint_tx_hash) = lower(n.mint_tx_hash)
          and p.tier is not null
          and (n.tier is distinct from p.tier or n.price_wei is distinct from p.amount_wei)`,
    ],
  },
];

export async function POST(req: Request): Promise<Response> {
  const limit = checkLimit(req, "admin-migrate", {limit: 5});
  if (limit.blocked) return limit.blocked;

  try {
    requireAdmin(req);
    const body = await readJsonBody(req);
    // Naming the action as well as the method: this one writes schema, and a
    // stray POST must not be enough to reach it.
    if (body.confirm !== "run-migrations") {
      return jsonError('Send {"confirm":"run-migrations"}.', 400, limit.headers);
    }

    const applied: string[] = [];
    for (const migration of MIGRATIONS) {
      // One transaction per migration, so a failure halfway leaves that
      // migration untouched rather than half applied.
      await tx(async (q) => {
        for (const statement of migration.statements) {
          await q([statement] as unknown as TemplateStringsArray);
        }
      });
      applied.push(migration.name);
    }

    return jsonOk({applied}, mergeHeaders(limit.headers, PRIVATE_CACHE));
  } catch (err) {
    // The real message, not the generic one. This route is admin-only and its
    // whole job is schema changes: a migration tool that hides why it failed is
    // worse than no tool, because the next step is guessing at the database.
    const detail = err instanceof Error ? err.message : String(err);
    return jsonError(detail, 500, limit.headers);
  }
}
