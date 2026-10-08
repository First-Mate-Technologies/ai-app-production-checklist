# Production checklist for AI-built apps

Lovable, Bolt, Replit, Cursor and v0 are tuned to make the demo work. They are much weaker at the parts nobody sees until something goes wrong: who can read which row, what happens when a payment webhook arrives twice, how you find out the app is down.

Work through this top to bottom. Anything you cannot answer is a launch blocker, not a nice-to-have. The first three sections (data, auth, payments) are the ones where a gap can hurt real people, so do those first.

Examples use Supabase because most of the apps we see are built on it. The questions apply to any backend.

Tools in this repo that help with the first section: [`sql/supabase-rls-audit.sql`](sql/supabase-rls-audit.sql) and the [scanner](scan/).

## Data & access

- [ ] **Row Level Security (RLS) is on for every table in an exposed schema.** A table in `public` without RLS can be read and written by anyone holding your anon key, and that key ships in your front end by design.
- [ ] **You know how each table got created.** Tables made with SQL or in a migration file start with RLS off. Only the Table Editor in the Supabase dashboard turns it on for you ([docs](https://supabase.com/docs/guides/database/tables)). Code generators write SQL, so tables they create can be wide open while the ones you made by hand are fine.
- [ ] **Tables with RLS on have at least one policy.** RLS with no policies denies everything, which is safe but usually means a feature is silently broken. Check that the empty ones are intentional.
- [ ] **Every policy is tested as a real user.** The dashboard SQL editor runs as a privileged role that skips RLS, so a policy that works there proves nothing. Sign in as two ordinary accounts and confirm A cannot see B's rows.
- [ ] **No service-role key in client code.** It bypasses RLS completely. If it is in your front-end bundle, every policy you wrote is decoration. Search the repo and the built bundle, and remember that anything prefixed `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_` or `REACT_APP_` is public.
- [ ] **Secrets live in environment variables, not the repo.** Check git history too. A key that was committed and later deleted is still exposed, so rotate it.
- [ ] **Policies do not trust data the user can edit.** In Supabase, `user_metadata` can be changed by the signed-in user. Put roles in `app_metadata` or a separate roles table ([docs](https://supabase.com/docs/guides/database/postgres/row-level-security)).
- [ ] **Views and functions respect RLS.** A view runs with its owner's permissions by default and can bypass your policies: on Postgres 15 and later, create it with `security_invoker = true`. A `SECURITY DEFINER` function in an exposed schema does the same for anyone who can call it, and `anon` can by default: revoke execute from `public` and `anon`, or make it `SECURITY INVOKER`. The SQL audit lists both.
- [ ] **Storage buckets have policies.** A public bucket serves every file to anyone with the URL. Invoices, IDs and private uploads need a private bucket and policies on `storage.objects`.

## Auth & permissions

- [ ] **Every request is authorized on the server.** Hiding a button is not access control. Call the API directly as a user who should be refused and confirm that it refuses.
- [ ] **Users can only touch their own records.** Change the ID in a URL or request body to another user's. You should get a 403 or 404, not their data.
- [ ] **Admin screens and admin actions check the role on the server.** A route that is merely not linked is still reachable.
- [ ] **Reset links, magic links and invites expire and work once.** Old links that still work are a standing back door.
- [ ] **Login, signup, password reset and one-time codes are rate limited.** Otherwise anyone can guess at them all day.
- [ ] **OAuth redirect URLs list only your real domains.** Remove localhost and old preview URLs before launch.
- [ ] **Signing out and disabling a user actually cut off access.** Test it with a second browser.

## Payments & webhooks

- [ ] **Orders are fulfilled from the webhook, not the success page.** The browser redirect can be closed, skipped or faked. The provider's webhook is the source of truth.
- [ ] **Webhook signatures are verified.** Verify against the raw request body and your endpoint secret (with Stripe, `constructEvent`). Without that, anyone can post a fake "payment succeeded" to your server.
- [ ] **The same event can arrive twice without doing damage.** Providers retry and sometimes deliver duplicates. Store the event ID and ignore repeats.
- [ ] **Requests that create charges use idempotency keys.** A double click or a network retry should never bill someone twice.
- [ ] **The unhappy paths work.** Declined card, expired card, refund, cancellation, downgrade, failed renewal. The plan stored in your database should always match the provider's.
- [ ] **Test keys and live keys are separated.** Live keys exist only in the production environment.

## Error handling & observability

- [ ] **Error tracking is installed on the front end and the back end.** Sentry or similar. Without it, you hear about bugs from angry users.
- [ ] **Failures show a useful message, not a blank screen.** Every async call has a loading, error and empty state, and the app has an error boundary.
- [ ] **Errors do not leak internals.** Users should never see a stack trace, a SQL error or a key.
- [ ] **Important actions are logged and searchable.** Payments, deletes and role changes: who, what, when. Passwords, tokens and card data stay out of the logs.
- [ ] **An uptime monitor alerts a channel someone reads.** You should know the app is down before a customer tells you.
- [ ] **Calls to other services have timeouts and retries.** Email, payments and AI APIs all fail sometimes. The app should fail gracefully when they do.

## Tests

AI tools and demos check the happy path: one user, clean data, everything goes right. On QueueMate, a free restaurant queue system we built in days, a second model wrote 554 QA cases and only 49 of them (about 9%) were happy path. The rest were edge, negative, boundary, security and concurrency cases, and they still surfaced 38 defects. Run these against your app before anyone else does. More on the method: [how we test AI-generated code](https://www.firstmate.tech/resources/how-we-test-ai-generated-code?utm_source=github&utm_medium=referral&utm_campaign=finish-kit).

- [ ] **Time zones.** Records created near midnight, a user in a different zone from your server, daylight saving changes. Store UTC and convert for display.
- [ ] **Empty and invalid input.** A blank form, 10,000 characters, emoji, quotes, negative numbers, a pasted script tag.
- [ ] **Double submit.** Double click the pay and save buttons. Refresh mid-request. Look for duplicate rows.
- [ ] **Concurrency.** Two people grab the last item at the same moment. Two tabs edit the same record.
- [ ] **Roles.** Try every action as each kind of user and as a logged-out visitor.
- [ ] **Dead ends.** A session that expires mid-form, the back button, a deep link opened while logged out, a slow connection.
- [ ] **One automated end-to-end test of the money path.** Sign up, do the core action, pay. Run it on every deploy.

## Performance & cost

- [ ] **No N+1 queries.** A list that fires one query per row is fine at 10 rows and falls over at 10,000.
- [ ] **Indexes on the columns you filter and join on, and pagination on every list.** Check the slowest page with real-sized data, not demo data.
- [ ] **LLM spend is capped.** Set max tokens, per-user limits and a spend limit with the provider, and log tokens per request. A loop or one abusive user can burn a month of budget overnight.
- [ ] **Expensive endpoints are rate limited.** Anything that calls a model, sends email, uploads files or exports data is a bill waiting to happen.
- [ ] **Long jobs run in the background.** Do not make a request wait on a task that can take a minute.
- [ ] **Pages are fast on a mid-range phone.** Compress images and lazy-load what is below the fold.

## Deploy & environments

- [ ] **Staging is separate from production and has its own database.** Do not test on real customer data.
- [ ] **Environment variables are documented and set per environment.** Keep an `.env.example`. A missing variable is the classic "works on my machine" failure.
- [ ] **Database changes are migrations in version control.** Changes made by clicking around a dashboard cannot be reproduced or rolled back.
- [ ] **Backups are on, and you have restored one.** A backup you have never restored is a hope, not a plan.
- [ ] **You can roll back in minutes.** Know how to put the previous version back, and keep migrations backward compatible where you can.
- [ ] **A merge deploys, and checks run first.** Type check, lint and tests should pass before anything reaches production.
- [ ] **Staging does not email real customers or get indexed by search engines.** Block both before the first invite goes out.

## Launch day

- [ ] **Domain, HTTPS and redirects work.** Pick www or the bare domain and redirect the other.
- [ ] **Email lands in the inbox.** Set SPF, DKIM and DMARC on your sending domain, then send test messages to Gmail and Outlook and check the spam folder.
- [ ] **Analytics and conversion events fire in production.** Verify on the live site, not in preview.
- [ ] **Privacy policy and terms are linked.** If you take payments or serve visitors in the EU or UK, check what else applies to you.
- [ ] **The small things are done.** Custom 404 page, favicon, page titles, share images, robots and sitemap.
- [ ] **You have smoke-tested production with a real signup and a real payment.** Refund it afterward.
- [ ] **Someone owns the first week.** Decide who receives the alerts and who fixes what they find.

---

Built by [First Mate Technologies](https://www.firstmate.tech/?utm_source=github&utm_medium=referral&utm_campaign=finish-kit). Stuck at 80%? See the [vibe-code rescue](https://www.firstmate.tech/vibe-code-rescue?utm_source=github&utm_medium=referral&utm_campaign=finish-kit): a two-week finish trial, and a free 30-minute app review.
