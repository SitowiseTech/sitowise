begin;

-- Node tiers.
--
-- A tier is the price a node was bought at, plus what that price buys: how many
-- of them one wallet may hold, and how fast the node accrues. Tiers above the
-- base one are gated on holding SITOWISE.
--
-- The tier is stored rather than derived from price_wei, because a tier's price
-- is a setting. Deriving it would mean that changing the price of a tier
-- silently reclassifies, or orphans, every node already sold at the old price.

alter table payments add column if not exists tier text;
alter table nodes    add column if not exists tier text not null default 'base';

-- Left unconstrained on purpose: tier ids live in lib/tiers.ts, and a check
-- constraint here would need a migration every time one is added. The write
-- paths validate against that module, and an unknown tier reads as base rather
-- than as a crash.

create index if not exists nodes_owner_tier_idx on nodes (owner_address, tier);
create index if not exists payments_from_tier_idx on payments (from_address, tier);

-- node_view names its columns, so the tier has to be added here too or nothing
-- reading through the view can see it.
create or replace view node_view as
select
  n.id,
  n.chain_node_id,
  n.owner_address,
  n.mint_tx_hash,
  n.price_wei,
  n.tier,
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
