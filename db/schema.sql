-- Sitowise base schema.
--
-- THIS FILE ALONE IS NOT A COMPLETE DATABASE. Apply it first, then every file
-- in db/migrations/ in filename order. Migration 002 is what moved the project
-- to on-chain balances: it drops the voucher-era tables and adds `payments`,
-- `node_schedule` and `watcher_state`, without which the payment watcher and
-- the credit worker cannot run.
--
-- Sitowise schema (spec section 9). Postgres / Neon.
-- Integrity rules enforced here rather than trusted to application code:
--   * cumulative_wei never decreases          -> trigger
--   * withdrawn_wei never exceeds cumulative  -> check
--   * withdrawn_wei only moves on a confirmed transaction (application rule)
--   * withdrawable = cumulative_wei - withdrawn_wei

create table if not exists wallets (
  address        text primary key check (address = lower(address)),
  first_seen_at  timestamptz not null default now(),
  last_login_at  timestamptz
);

create table if not exists nodes (
  id             bigserial primary key,
  chain_node_id  numeric(78,0) unique not null,
  owner_address  text not null references wallets(address) on update cascade,
  mint_tx_hash   text unique not null,
  price_wei      numeric(78,0) not null check (price_wei >= 0),
  status         text not null default 'active' check (status in ('active','retired')),
  created_at     timestamptz not null default now()
);

create table if not exists distributions (
  id           bigserial primary key,
  mode         text not null check (mode in ('treasury','swaps')),
  total_wei    numeric(78,0) not null check (total_wei >= 0),
  node_count   int not null check (node_count >= 0),
  created_at   timestamptz not null default now()
);

create table if not exists credits (
  id               bigserial primary key,
  distribution_id  bigint not null references distributions(id) on delete cascade,
  node_id          bigint not null references nodes(id) on delete cascade,
  amount_wei       numeric(78,0) not null check (amount_wei > 0),
  created_at       timestamptz not null default now()
);

create table if not exists node_balances (
  node_id         bigint primary key references nodes(id) on delete cascade,
  cumulative_wei  numeric(78,0) not null default 0 check (cumulative_wei >= 0),
  withdrawn_wei   numeric(78,0) not null default 0 check (withdrawn_wei >= 0),
  updated_at      timestamptz not null default now(),
  constraint withdrawn_not_over_cumulative check (withdrawn_wei <= cumulative_wei)
);

create table if not exists withdrawals (
  id                 bigserial primary key,
  node_id            bigint not null references nodes(id) on delete cascade,
  to_address         text not null,
  amount_wei         numeric(78,0) not null check (amount_wei > 0),
  cumulative_signed  numeric(78,0) not null,
  deadline           bigint not null,
  tx_hash            text,
  status             text not null default 'signed' check (status in ('signed','sent','failed')),
  created_at         timestamptz not null default now(),
  confirmed_at       timestamptz
);

-- Bookkeeping for the distribution worker: one row, id = 1.
create table if not exists worker_state (
  id                smallint primary key default 1 check (id = 1),
  last_run_at       timestamptz,
  last_error        text,
  paused_reason     text
);
insert into worker_state (id) values (1) on conflict do nothing;

-- ------------------------------------------------------------------ indexes

create index if not exists nodes_owner_idx           on nodes (owner_address);
create index if not exists nodes_chain_id_idx        on nodes (chain_node_id);
create index if not exists credits_node_time_idx     on credits (node_id, created_at desc);
create index if not exists credits_distribution_idx  on credits (distribution_id);
create index if not exists credits_created_idx       on credits (created_at desc);
create index if not exists withdrawals_node_idx      on withdrawals (node_id);
create index if not exists withdrawals_status_idx    on withdrawals (status);
create index if not exists distributions_created_idx on distributions (created_at desc);

-- ----------------------------------------------------------------- triggers

-- cumulative_wei is monotonic: a decrease is a bug, so make it impossible.
create or replace function assert_cumulative_monotonic() returns trigger as $$
begin
  if new.cumulative_wei < old.cumulative_wei then
    raise exception 'cumulative_wei may not decrease (node % : % -> %)',
      old.node_id, old.cumulative_wei, new.cumulative_wei;
  end if;
  if new.withdrawn_wei < old.withdrawn_wei then
    raise exception 'withdrawn_wei may not decrease (node % : % -> %)',
      old.node_id, old.withdrawn_wei, new.withdrawn_wei;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists node_balances_monotonic on node_balances;
create trigger node_balances_monotonic
  before update on node_balances
  for each row execute function assert_cumulative_monotonic();

-- Every node gets a balance row the moment it exists.
create or replace function create_balance_row() returns trigger as $$
begin
  insert into node_balances (node_id) values (new.id) on conflict do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists nodes_create_balance on nodes;
create trigger nodes_create_balance
  after insert on nodes
  for each row execute function create_balance_row();

-- -------------------------------------------------------------------- views

create or replace view node_view as
select
  n.id,
  n.chain_node_id,
  n.owner_address,
  n.mint_tx_hash,
  n.price_wei,
  n.status,
  n.created_at,
  coalesce(b.cumulative_wei, 0)                              as cumulative_wei,
  coalesce(b.withdrawn_wei, 0)                               as withdrawn_wei,
  coalesce(b.cumulative_wei, 0) - coalesce(b.withdrawn_wei, 0) as balance_wei
from nodes n
left join node_balances b on b.node_id = n.id;
