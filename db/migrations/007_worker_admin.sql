-- Sitowise migration 002: runtime settings, alerts, worker bookkeeping.
--
-- Additive to db/schema.sql; run it after that file, and it is safe to re-run.
--
-- Why a settings table at all: spec 8.3 keeps the distribution numbers in env,
-- and env is still the source of truth for a fresh deployment. But /admin has
-- to be able to stop a runaway distribution without a redeploy, and a web page
-- cannot mutate the process environment of a worker running on another host.
-- So env supplies the baseline and a row here overrides it. Absent row = env.

create table if not exists settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  -- Free text: "admin" for the console, "worker" for anything it writes back.
  updated_by  text
);

-- Operational alerts (spec 8.4, shown by spec 14). Rows are written by the
-- worker and cleared either by the worker when the condition goes away or by a
-- human in /admin.
create table if not exists alerts (
  id           bigserial primary key,
  kind         text not null,
  severity     text not null default 'warn' check (severity in ('warn', 'stop')),
  message      text not null,
  -- Numbers behind the sentence: wei amounts as strings, block numbers, counts.
  detail       jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- One open alert per kind. A condition that repeats every 90 seconds must
-- refresh the existing row rather than write 960 rows a day, and the partial
-- index is what lets `on conflict (kind) where resolved_at is null` do that.
create unique index if not exists alerts_open_kind_idx
  on alerts (kind) where resolved_at is null;

create index if not exists alerts_created_idx on alerts (created_at desc);

-- ------------------------------------------------------- worker bookkeeping

alter table worker_state
  -- Process liveness. last_run_at only moves on a committed distribution, so a
  -- worker that is up but idle (no nodes, disabled) would look dead without it.
  add column if not exists last_tick_at   timestamptz,
  add column if not exists started_at     timestamptz,
  -- When the current sleep ends. Shown in /admin so "nothing is happening" is
  -- distinguishable from "the next round is 70 seconds away".
  add column if not exists next_run_at    timestamptz,
  -- Set by /admin's "distribute now"; the worker consumes it and clears it.
  add column if not exists run_now_at     timestamptz,
  -- swaps mode: last block whose SwapAccrued logs have been credited.
  add column if not exists last_block     bigint,
  -- swaps mode: accrued value too small to split into positive per-node credits
  -- this round. Carried into the next one instead of being lost to rounding.
  add column if not exists carry_wei      numeric(78,0) not null default 0 check (carry_wei >= 0),
  -- Last value handed to SitowiseFactory.publishCredited. The contract bounds
  -- rescue() by it, so a gap between this and sum(cumulative_wei) means the
  -- owner could withdraw value that is already owed to node holders.
  add column if not exists published_wei  numeric(78,0) not null default 0 check (published_wei >= 0);

insert into worker_state (id) values (1) on conflict do nothing;
