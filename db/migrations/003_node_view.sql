-- Migration 003: bring back node_view.
--
-- Migration 002 dropped it along with node_balances, but lib/nodes.ts still
-- reads from it, so /api/node/:id and /api/nodes/:address returned 500 on a
-- migrated database. This rebuilds it without the dropped table.
--
-- The money columns are derived from recorded history (`credits` minus observed
-- `withdrawals`) rather than from a mutable balance row. They are LEDGER
-- figures for the public API and the activity feed. The contract remains the
-- authority: the dashboard reads balances with `nodeInfo`/`balanceOfOwner`, and
-- a node minted directly against the contract can legitimately have credits the
-- ledger has not seen yet.
--
-- Subqueries rather than joins on purpose: joining both credits and withdrawals
-- would multiply rows and silently inflate every sum.

begin;

create or replace view node_view as
select
  n.id,
  n.chain_node_id,
  n.owner_address,
  n.mint_tx_hash,
  n.price_wei,
  n.status,
  n.created_at,
  coalesce(c.total, 0)                          as cumulative_wei,
  coalesce(w.total, 0)                          as withdrawn_wei,
  greatest(coalesce(c.total, 0) - coalesce(w.total, 0), 0) as balance_wei
from nodes n
left join lateral (
  select sum(amount_wei) as total from credits where node_id = n.id
) c on true
left join lateral (
  select sum(amount_wei) as total from withdrawals where node_chain_id = n.chain_node_id
) w on true;

commit;
