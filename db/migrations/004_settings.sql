-- Migration 004: the settings table.
--
-- lib/settings.ts reads and writes `settings` so /admin can retune distribution
-- without a redeploy: the worker is a separate long-lived process and nothing
-- from a web request reaches its process.env. The table was written against but
-- never created, so every credit pass threw on the first query and the cron
-- endpoint answered 500 before it even reached the DIST_ENABLED check.
--
-- One row per overridden field. No row means the env value is in force, which
-- is why there is no seeding here: an empty table is the correct initial state.

begin;

create table if not exists settings (
  key         text primary key,
  value       text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

commit;
