-- Exercises every branch of supabase-rls-audit.sql against a throwaway local Supabase database.
-- Everything happens inside one transaction that ends in ROLLBACK, so nothing is kept.
--
-- Run it from the sql/ folder against a LOCAL database (never production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f verify-audit.sql
-- See sql/README.md for what the output should show.

\set ON_ERROR_STOP on
\echo === probe start (inside a transaction) ===
begin;

-- rls_disabled (and anon / authenticated can select, via default Supabase grants)
create table public.zz_probe_rls_off (id int);
grant select on public.zz_probe_rls_off to anon, authenticated;
-- rls_no_policies
create table public.zz_probe_rls_on_nopol (id int);
alter table public.zz_probe_rls_on_nopol enable row level security;
-- policy_uses_user_meta
create table public.zz_probe_meta (id int, owner uuid);
alter table public.zz_probe_meta enable row level security;
create policy zz_meta_pol on public.zz_probe_meta for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');
-- policy_allows_everyone: HIGH (writes), MEDIUM (select only), and three that must NOT be reported
create table public.zz_probe_policies (id int);
alter table public.zz_probe_policies enable row level security;
create policy zz_true_all on public.zz_probe_policies for all to anon, authenticated using (true) with check (true);
create policy zz_true_insert on public.zz_probe_policies for insert to public with check (true);
create policy zz_true_select on public.zz_probe_policies for select to authenticated using ((true));
create policy zz_ok_owner on public.zz_probe_policies for update to authenticated using (id = 1);
create policy zz_ok_service on public.zz_probe_policies for all to service_role using (true);
create policy zz_ok_restrictive on public.zz_probe_policies as restrictive for all to anon using (true);

-- view_bypasses_rls: flagged = default, security_invoker=false. Not flagged = true, on, y.
create view public.zz_probe_view_default as select * from public.zz_probe_meta;
create view public.zz_probe_view_false with (security_invoker = false) as select * from public.zz_probe_meta;
create view public.zz_probe_view_true with (security_invoker = true) as select * from public.zz_probe_meta;
create view public.zz_probe_view_on with (security_invoker = on) as select * from public.zz_probe_meta;
create view public.zz_probe_view_y with (security_invoker = y) as select * from public.zz_probe_meta;
-- matview_exposed
create materialized view public.zz_probe_mv as select 1 as x;

-- security_definer_rpc: flagged = definer + anon can execute. Not flagged = invoker, revoked, trigger.
create function public.zz_probe_definer_open() returns int language sql security definer as $$ select 1 $$;
create function public.zz_probe_definer_revoked() returns int language sql security definer as $$ select 1 $$;
revoke execute on function public.zz_probe_definer_revoked() from public, anon, authenticated;
create function public.zz_probe_invoker() returns int language sql security invoker as $$ select 1 $$;
create function public.zz_probe_definer_trigger() returns trigger language plpgsql security definer as $$ begin return new; end $$;

-- public_bucket
insert into storage.buckets (id, name, public) values ('zz-probe-public', 'zz-probe-public', true);
insert into storage.buckets (id, name, public) values ('zz-probe-private', 'zz-probe-private', false);

\echo === audit output: only zz_probe rows matter ===
\ir supabase-rls-audit.sql

rollback;
\echo === after rollback: leftover probe objects (all must be 0) ===
select count(*) as leftover_relations from pg_class where relname like 'zz_probe%';
select count(*) as leftover_buckets from storage.buckets where id like 'zz-probe-%';
select count(*) as leftover_functions from pg_proc where proname like 'zz_probe%';
