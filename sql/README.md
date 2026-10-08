# SQL audit

[`supabase-rls-audit.sql`](supabase-rls-audit.sql) is one read-only `SELECT` for the Supabase SQL editor. It reads system catalogs and `storage.buckets` and changes nothing.

| `check_name` | Severity | What it means |
| --- | --- | --- |
| `rls_disabled` | HIGH | Table in an exposed schema with Row Level Security off. `anon_can_select` and `authenticated_can_select` say whether those roles can read it. |
| `rls_no_policies` | MEDIUM | RLS on, zero policies: the API returns nothing. Fine for server-only tables. |
| `policy_uses_user_meta` | HIGH | A policy reads `user_metadata`, which signed-in users can edit. |
| `policy_allows_everyone` | HIGH / MEDIUM | A permissive policy for `public`, `anon` or `authenticated` whose `USING` or `WITH CHECK` is literally `true`. HIGH if it can write, MEDIUM if it is `SELECT` only. |
| `view_bypasses_rls` | HIGH | View without `security_invoker` set to true (Postgres 15 and later). |
| `matview_exposed` | MEDIUM | Materialized view in an exposed schema. They cannot have RLS. |
| `security_definer_rpc` | HIGH | `SECURITY DEFINER` function in an exposed schema that `anon` can execute. |
| `public_bucket` | MEDIUM | Storage bucket anyone can read by URL. |

Every row is a pointer, not a verdict. A public avatar bucket or a read-only `true` policy on a product catalog is fine if you meant it.

## Verify the audit yourself

[`verify-audit.sql`](verify-audit.sql) creates one object for every branch (and several look-alikes that must not be reported), runs the audit through `\ir`, then issues `ROLLBACK`. Run it against a **local** Supabase database, never production:

```sh
cd sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f verify-audit.sql
```

(Use the DB URL printed by `supabase status`.) In the output, look only at rows whose object name contains `zz_probe`:

| Reported | Not reported (these are the negative cases) |
| --- | --- |
| `zz_probe_rls_off` (`rls_disabled`, both `can_select` columns `t`) | `zz_probe_view_true`, `_on`, `_y` (security_invoker set) |
| `zz_probe_rls_on_nopol` (`rls_no_policies`) | `zz_ok_owner`, `zz_ok_service` (restricted policies) |
| `zz_probe_meta / zz_meta_pol` (`policy_uses_user_meta`) | `zz_ok_restrictive` (restrictive policies only narrow access) |
| `zz_true_all`, `zz_true_insert` (`policy_allows_everyone`, HIGH) | `zz_probe_definer_revoked()` (execute revoked) |
| `zz_true_select` (`policy_allows_everyone`, MEDIUM) | `zz_probe_invoker()` (security invoker) |
| `zz_probe_view_default`, `_false` (`view_bypasses_rls`) | `zz_probe_definer_trigger()` (trigger function) |
| `zz_probe_mv` (`matview_exposed`) | `zz-probe-private` bucket |
| `zz_probe_definer_open()` (`security_definer_rpc`) | |
| `zz-probe-public` (`public_bucket`) | |

The last three queries must print `0`: nothing from the probe survives the rollback. Any other rows in the output are real findings in your local database.
