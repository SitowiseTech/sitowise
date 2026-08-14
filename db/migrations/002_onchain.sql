-- Sitowise migration 002: off-chain vouchers -> on-chain balances.
-- Spec: ~/Desktop/isonode-onchain-spec.md section 6.
--
-- The contract is now the source of truth for money. Postgres keeps payments,
-- schedules, and history for the feed and the graphs. Nothing here may be used
-- to display a balance: the dashboard reads balances from the chain.

begin;

-- ---------------------------------------------------------- drop the vouchers

-- node_balances existed only to hold the off-chain cumulative/withdrawn figures
-- that vouchers were signed against. The contract owns those numbers now, and
-- keeping a second copy invites showing a stale one.
drop trigger if exists node_balances_monotonic on node_balances;
drop function if exists assert_cumulative_monotonic();
drop view if exists node_view;
drop table if exists node_balances;

-- Withdrawals are no longer prepared and signed by us; they happen directly
-- from the user's wallet. What is worth keeping is an indexed copy of the
-- on-chain Withdrawn events, which is a different shape entirely.
drop table if exists withdrawals;

create table if not exists withdrawals (
  id             bigserial primary key,
  node_chain_id  numeric(78,0) not null,
  to_address     text not null,
  amount_wei     numeric(78,0) not null check (amount_wei > 0),
  tx_hash        text unique not null,
  block_number   bigint not null,
  observed_at    timestamptz not null default now()
);

-- ------------------------------------------------------------- new: payments

-- Incoming node payments, seen on the payments wallet before any mint.
-- Written at 'seen' BEFORE minting starts so a crash cannot lose a paid sale.
create table if not exists payments (
  id             bigserial primary key,
  tx_hash        text unique not null,          -- stops a double mint for one payment
  from_address   text not null,
  amount_wei     numeric(78,0) not null,
  block_number   bigint not null,
  status         text not null default 'seen'
                 check (status in ('seen','minting','minted','failed','manual_review')),
  node_chain_id  numeric(78,0),                 -- filled after a successful mint
  mint_tx_hash   text,
  attempts       int not null default 0,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------- new: per-node credit timer

-- One row per node. Each node carries its own next due time, which is what
-- makes the nodes desync instead of all paying out on one shared tick.
create table if not exists node_schedule (
  node_chain_id   numeric(78,0) primary key,
  next_credit_at  timestamptz not null,
  last_credit_at  timestamptz,
  credits_count   bigint not null default 0,
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------- new: block-reading cursor

-- Where the payment watcher stopped. Without this a restart re-reads from the
-- current block and silently drops every payment made while it was down.
create table if not exists watcher_state (
  key         text primary key,                 -- 'payments'
  last_block  bigint not null,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- indexes

create index if not exists payments_status_idx      on payments (status);
create index if not exists payments_from_idx        on payments (from_address);
create index if not exists payments_block_idx       on payments (block_number);
create index if not exists schedule_due_idx         on node_schedule (next_credit_at);
create index if not exists withdrawals_node_idx     on withdrawals (node_chain_id);
create index if not exists withdrawals_block_idx    on withdrawals (block_number);

commit;
