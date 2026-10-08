-- Supabase RLS audit
-- Paste this whole file into the Supabase SQL editor and click Run.
--
-- It is one SELECT statement. It reads the system catalogs and changes nothing.
-- Each row in the result is something to look at. No rows means none of the
-- eight checks found anything.
--
-- Checks (the check_name column):
--   rls_disabled           HIGH    table in an exposed schema with RLS off
--   rls_no_policies        MEDIUM  RLS on but zero policies (everything is denied)
--   policy_uses_user_meta  HIGH    policy reads user_metadata, which users can edit
--   policy_allows_everyone HIGH    policy that writes with a literal "true" check for anon or
--                                  authenticated (MEDIUM if it only reads)
--   view_bypasses_rls      HIGH    view without security_invoker=true (Postgres 15+)
--   matview_exposed        MEDIUM  materialized view in an exposed schema
--   security_definer_rpc   HIGH    SECURITY DEFINER function that anon can call
--   public_bucket          MEDIUM  storage bucket anyone can read by URL
--
-- anon_can_select and authenticated_can_select say whether those API roles can read the
-- table or view at all. They are null for rows that are not a table or view.
--
-- Exposed schemas: the API serves the schemas listed under Settings > API >
-- Exposed schemas. The default is public. If you exposed others, add them to the
-- VALUES list below, for example: values ('public'), ('app').
--
-- This is a pointer, not a verdict. A public bucket for avatars is fine, and a
-- table with no policies is fine if only your server touches it. The point is
-- that every row here should be a decision you made on purpose.

select *
from (

  with exposed(schema_name) as (
    values ('public')
  ),
  rels as (
    select
      n.nspname  as schema_name,
      c.relname  as object_name,
      c.relkind,
      c.relrowsecurity,
      c.reloptions,
      c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in (select schema_name from exposed)
      and c.relkind in ('r', 'p', 'v', 'm')          -- table, partitioned table, view, materialized view
      and not c.relispartition                        -- partitions are reached through their parent
      and not exists (                                -- skip objects owned by extensions (for example PostGIS)
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
  )

  -- (a) tables with RLS disabled
  select
    'rls_disabled'::text as check_name,
    'HIGH'::text         as severity,
    r.schema_name,
    r.object_name,
    has_table_privilege('anon', r.oid, 'select') as anon_can_select,
    has_table_privilege('authenticated', r.oid, 'select') as authenticated_can_select,
    'Row Level Security is off. Anyone with the anon key can read and write this table if the role has privileges on it.'::text as detail
  from rels r
  where r.relkind in ('r', 'p')
    and not r.relrowsecurity

  union all

  -- (b) tables with RLS enabled but no policies
  select
    'rls_no_policies',
    'MEDIUM',
    r.schema_name,
    r.object_name,
    has_table_privilege('anon', r.oid, 'select'),
    has_table_privilege('authenticated', r.oid, 'select'),
    'RLS is on and there are no policies, so the API returns nothing for this table. Fine if only the server uses it, broken if the app needs it.'
  from rels r
  where r.relkind in ('r', 'p')
    and r.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = r.oid)

  union all

  -- (c) policies that read user-editable metadata (any schema, including storage)
  select
    'policy_uses_user_meta',
    'HIGH',
    pol.schemaname::text,
    pol.tablename::text || ' / ' || pol.policyname::text,
    null::boolean,
    null::boolean,
    'Policy refers to user_metadata or raw_user_meta_data. Signed-in users can edit that data, so they can grant themselves access. Use app_metadata or a roles table.'
  from pg_policies pol
  where pol.qual ~* '(user_metadata|raw_user_meta_data)'
     or pol.with_check ~* '(user_metadata|raw_user_meta_data)'

  union all

  -- (c2) permissive policies whose check is literally "true" for anon or authenticated
  select
    'policy_allows_everyone',
    case when pol.cmd = 'SELECT' then 'MEDIUM' else 'HIGH' end,
    pol.schemaname::text,
    pol.tablename::text || ' / ' || pol.policyname::text,
    null::boolean,
    null::boolean,
    'Policy for ' || pol.cmd || ' (roles: ' || array_to_string(pol.roles, ', ') || ') is always true, so '
      || case when pol.cmd = 'SELECT' then 'every row is readable by those roles. Fine for a public catalog, wrong for user data.'
              else 'those roles can change every row. This is the same as having RLS off.' end
  from pg_policies pol
  where pol.permissive = 'PERMISSIVE'
    and pol.schemaname in (select schema_name from exposed union select 'storage')
    and pol.roles && array['public', 'anon', 'authenticated']::name[]
    and (
      lower(regexp_replace(coalesce(pol.qual, ''), '[()[:space:]]', '', 'g')) = 'true'
      or lower(regexp_replace(coalesce(pol.with_check, ''), '[()[:space:]]', '', 'g')) = 'true'
    )

  union all

  -- (d) views that run with their owner's rights (no security_invoker)
  select
    'view_bypasses_rls',
    'HIGH',
    r.schema_name,
    r.object_name,
    has_table_privilege('anon', r.oid, 'select'),
    has_table_privilege('authenticated', r.oid, 'select'),
    'View does not set security_invoker=true, so it ignores the RLS policies of the tables underneath. Fix: alter view <name> set (security_invoker = true);'
  from rels r
  where r.relkind = 'v'
    and current_setting('server_version_num')::int >= 150000
    and not exists (
      select 1
      from pg_options_to_table(r.reloptions)
      where option_name = 'security_invoker'
        and option_value::boolean
    )

  union all

  -- (d2) materialized views cannot use RLS or security_invoker at all
  select
    'matview_exposed',
    'MEDIUM',
    r.schema_name,
    r.object_name,
    has_table_privilege('anon', r.oid, 'select'),
    has_table_privilege('authenticated', r.oid, 'select'),
    'Materialized views cannot have RLS. If the API roles can select from it, anyone with the anon key can read it. Move it to a schema that is not exposed.'
  from rels r
  where r.relkind = 'm'

  union all

  -- (d3) SECURITY DEFINER functions that anon can call (PostgREST exposes them at /rest/v1/rpc/<name>)
  select
    'security_definer_rpc',
    'HIGH',
    n.nspname::text,
    p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    null::boolean,
    null::boolean,
    'Function runs with its owner''s rights and anon can execute it, so it bypasses RLS for anyone with the anon key. Fix: revoke execute from public and anon, or make it SECURITY INVOKER.'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (select schema_name from exposed)
    and p.prosecdef
    and p.prokind = 'f'
    and p.prorettype <> 'trigger'::regtype
    and has_function_privilege('anon', p.oid, 'execute')
    and not exists (
      select 1
      from pg_depend d
      where d.classid = 'pg_proc'::regclass
        and d.objid = p.oid
        and d.deptype = 'e'
    )

  union all

  -- (e) public storage buckets
  select
    'public_bucket',
    'MEDIUM',
    'storage',
    b.name::text,
    null::boolean,
    null::boolean,
    'Bucket is public: every file in it can be fetched by anyone who has the URL. Fine for avatars and marketing images, wrong for invoices, IDs and private uploads.'
  from storage.buckets b
  where b.public

) findings
order by
  case severity when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end,
  check_name,
  schema_name,
  object_name;
