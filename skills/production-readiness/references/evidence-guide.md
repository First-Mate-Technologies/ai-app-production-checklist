# Evidence guide

Where to look, per checklist section, and what a pass looks like. These are starting points: read the code around each hit.

## Scanner rules

| Rule | Meaning | Typical fix |
| --- | --- | --- |
| `service-role-in-client` | Supabase service_role / `sb_secret` key or env name in browser code | Move to a server route; rotate the key |
| `service-role-hardcoded` | Key literal in server or unclassified code | Env var; rotate |
| `public-env-secret` | `NEXT_PUBLIC_`/`VITE_`/`EXPO_PUBLIC_`/`REACT_APP_` var named like a secret | Rename without the prefix; server only |
| `stripe-secret-key`, `stripe-webhook-secret` | Stripe key or `whsec_` literal | Env var; roll the key |
| `stripe-webhook-unverified` | Webhook handler with no signature verification | `constructEvent` on the raw body |
| `committed-env-file` | Env file tracked by git | `git rm --cached`, ignore, rotate everything in it |
| `gitignore-missing-env` | An env file on disk no `.gitignore` rule covers | Ignore `.env*`, keep `!.env.example` |

Files classified "unknown" (Next.js server components, shared libs) are not reported as client leaks. If a server file's key is imported by a `"use client"` file, the scanner will miss it; check imports of any file with a service-role client.

## Data & access
- Migrations: `grep -rn "enable row level security\|create policy\|security_invoker\|security definer" supabase/ prisma/ db/ migrations/`
- Every `create table` in an exposed schema should have a matching `enable row level security`.
- Policies: look for `user_metadata`, `using (true)`, `with check (true)`; ownership should compare `auth.uid()` to an owner column.
- Client creation: `grep -rn "createClient\|createBrowserClient\|createServerClient"` and check which key each file uses.
- History: `git log -S "<kind of key>" --oneline` (do not print the match); a key committed once is exposed.

## Auth & permissions
- Route handlers, server actions, API routes: each should call a server-side session check (`getUser()`, `auth()`, `getServerSession`) before touching data, then filter by the user id.
- Prisma or another ORM often replaces PostgREST for server code; look for a wrapper that sets the user for RLS (for example a `withUserRls` helper) and for queries that bypass it.
- Pass: ownership comes from the session, not from a request body or URL parameter.
- Admin pages/actions: look for a role check on the server, not just a hidden link. Middleware alone is weak; check the handler too.
- Rate limiting: `grep -rn "ratelimit\|rate-limit\|rateLimit\|upstash"`; auth providers often rate limit on their side (UNKNOWN unless config shows it).
- Redirect URLs: `supabase/config.toml` `additional_redirect_urls`, provider dashboards (UNKNOWN from code).

## Payments & webhooks
- Handler path usually contains `webhook`. Pass: raw body (`req.text()`, `express.raw`, `request.body` unparsed) goes to `constructEvent`/`construct_event`.
- Idempotency: a processed-events table or unique constraint on the event id; `Idempotency-Key` on charge creation.
- Fulfillment happens in the webhook, not on the `success_url` page.
- Key separation: env names such as `STRIPE_SECRET_KEY` per environment; `sk_live_` never in dev config.

## Error handling & observability
- `grep -rn "Sentry\|@sentry\|bugsnag\|rollbar\|datadog\|posthog"`; check both client and server init.
- `error.tsx`, `global-error.tsx`, `try/catch` around fetches, loading and empty states.
- Responses that return `error.message` or a stack to the client leak internals.
- Timeouts: `AbortController`, `timeout:` options, retry libraries around email/payment/LLM calls.

## Tests
- Find the runner (`vitest`, `jest`, `playwright`, `cypress`, `node --test`) and count tests per area.
- For each of: time zones, empty/invalid input, double submit, concurrency, roles, dead ends, money-path e2e, search test names and fixtures. No hit = `FAIL` (not covered), and offer to draft the test.

## Performance & cost
- N+1: queries inside `.map`/`for` loops (`await supabase.from(...)` or `prisma.` in a loop).
- Indexes: foreign keys and filtered columns in migrations; pagination (`.range(`, `limit`, `take`, cursors).
- LLM calls: `max_tokens`/`maxTokens` set, per-user limits, provider spend cap (UNKNOWN from code).

## Deploy & environments
- `.env.example` present and complete; env names used in code (`process.env.X`) appear in it.
- Migrations in version control; no schema changes made only in a dashboard (UNKNOWN unless drift is visible).
- CI: `.github/workflows` runs type check, lint and tests before deploy.
- Backups, rollback, staging isolation: UNKNOWN from code unless documented in the repo.

## Launch day
- 404 page, favicon, metadata (`generateMetadata`, `<title>`), `robots.txt`, sitemap, privacy/terms links in the footer.
- Email SPF/DKIM/DMARC, DNS, analytics firing in production: UNKNOWN from code.
