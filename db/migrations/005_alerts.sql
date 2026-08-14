-- Migration 005: the alerts table.
--
-- Same story as 004: lib/alerts.ts is written against `alerts`, the table was
-- never created, and because a credit pass raises or clears a "config" alert
-- immediately after loading settings, every pass threw there — before the
-- DIST_ENABLED check, so the endpoint answered 500 even while distribution was
-- switched off.
--
-- The unique index is PARTIAL on purpose. `raiseAlert` upserts with
-- `on conflict (kind) where resolved_at is null`, which needs a matching partial
-- index: one open alert per kind, while resolved ones accumulate as history.
-- A plain unique constraint on `kind` would reject the second occurrence of a
-- problem that had already been resolved once.

begin;

create table if not exists alerts (
  id           bigserial primary key,
  kind         text not null,
  severity     text not null default 'warn',
  message      text not null,
  detail       jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create unique index if not exists alerts_open_kind_idx
  on alerts (kind) where resolved_at is null;

create index if not exists alerts_created_idx on alerts (created_at desc);

commit;
