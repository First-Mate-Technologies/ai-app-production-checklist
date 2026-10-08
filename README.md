# The FINISH kit: a production checklist for AI-built apps

You built an app with Lovable, Bolt, Replit, Cursor or v0. It demos fine. Then you tried to put real users on it and it stalled at about 80%.

This kit is for you if that sounds familiar. It is what we run before an AI-built app takes real traffic, packaged so you can run it yourself:

- **[CHECKLIST.md](CHECKLIST.md)**: 55 tick boxes across data access, auth, payments, error handling, tests, performance, deploys and launch day. One line each, with the reason.
- **[sql/supabase-rls-audit.sql](sql/supabase-rls-audit.sql)**: one read-only query for the Supabase SQL editor. Finds tables with Row Level Security off, policies that trust user-editable metadata or are always true, views and `SECURITY DEFINER` functions that bypass RLS, and public storage buckets. [`sql/README.md`](sql/README.md) shows how to verify it.
- **[scan/](scan/)**: a small Node script that scans your project folder for launch blockers, like a service-role key in front-end code or a committed `.env`. No dependencies, no network, and it never prints a full secret.

## Why the tests section matters most

Demos and AI tools check the happy path: one user, clean data, everything goes right. Real users do not live there.

QueueMate is a free restaurant queue system we built in days, and our agents tested it as they built it. A second model then generated 554 QA cases. Only 49 of them, about 9%, were happy path, and the sweep still surfaced 38 defects. We filed all of them before fixing a single one. Read how it worked: [how we test AI-generated code](https://www.firstmate.tech/resources/how-we-test-ai-generated-code?utm_source=github&utm_medium=referral&utm_campaign=finish-kit).

## Quickstart

**1. Scan your project.** You need Node 20 or newer. Clone or download this repo, then point the scanner at your app's folder:

```sh
npx github:First-Mate-Technologies/ai-app-production-checklist /path/to/your-app
# or, from a clone of this repo:
node scan/cli.mjs /path/to/your-app
```

It prints findings grouped by severity with `file:line`. Add `--json` for machine output. The exit code is 1 if there is any HIGH finding, so you can also run it in CI.

**2. Audit your Supabase database.** Open the SQL editor in your Supabase dashboard, paste in [`sql/supabase-rls-audit.sql`](sql/supabase-rls-audit.sql) and run it. Every row in the result is something to look at. No rows means none of the checks found anything. The query only reads system catalogs.

**3. Work the checklist.** Go through [CHECKLIST.md](CHECKLIST.md) top to bottom. Anything you cannot answer in the first three sections (data, auth, payments) is a launch blocker.

## Use it as AI agent skills

The kit ships two skills for Claude Code and Codex.

**`production-readiness`** audits your app before launch. Ask "is my app ready to launch?" and it detects your stack, runs the scanner, walks the checklist against your actual code, and writes a prioritized `PRODUCTION_READINESS.md` with `file:line` evidence. It is read-only: it never edits code or touches your database without your say-so, and it never prints secret values.

**`break-my-app`** is the QA method from the QueueMate story above. It writes `qa/REQUIREMENTS.md` from your code and docs, has a separate designer (a fresh subagent, ideally on a different model) write `qa/TEST_CASES.md` weighted toward edge, negative, boundary, security, concurrency and time zone cases, and reports the real happy-path share. With your yes it turns the top cases into tests in your own runner, with a guard so they never hit real Stripe, email or LLM APIs, runs them, and files every failure in `qa/DEFECTS.md` before any fix. It tells you honestly how independent the case designer was.

```sh
git clone https://github.com/First-Mate-Technologies/ai-app-production-checklist
cd ai-app-production-checklist
scripts/install-skill.sh claude                 # both skills into ~/.claude/skills/
scripts/install-skill.sh codex                  # both skills into ~/.agents/skills/
scripts/install-skill.sh claude --project       # ./.claude/skills/ (commit it for your team)
scripts/install-skill.sh codex --skill break-my-app   # just one skill
```

Options: `--project` installs into the current folder, `--force` replaces an existing install, `--skill production-readiness|break-my-app|all` picks the skill (default `all`). The script copies local files only (no network, no sudo), prints what it does, and refuses to overwrite an existing install unless you pass `--force`. `production-readiness` bundles the scanner, the checklist and the SQL audit; `break-my-app` bundles a small helper that counts your case mix. Restart the agent if a skill does not show up. By hand: copy `skills/<name>/` to `~/.claude/skills/` (Claude Code) or `~/.agents/skills/` (Codex), or into `.claude/skills/` or `.agents/skills/` inside a project. A hand copy of `production-readiness` has no bundled scanner, so it falls back to `npx github:First-Mate-Technologies/ai-app-production-checklist`.

Example prompts:

- `is my app ready to launch?` or `audit my vibe-coded app before I go live`
- `try to break my app and write test cases`
- `QA my app` or `what edge cases am I missing?`
- `find bugs before users do`, then answer "yes, run the tests" when it asks

For the strongest `break-my-app` result, build with one tool and let the other design the cases (for example build in Claude Code, design in Codex), or at least run the design step on a different model. Without that, the skill says "fresh context only" or "none" in its summary instead of claiming independence it did not have.

`--project` installs into the current directory's `.claude/skills/` or `.agents/skills/`, so run it from the root of your app, not from this repo. On Windows, run the script from Git Bash or WSL, or copy `skills/<name>/` into the same folders by hand.

The frontmatter has `name` and `description` plus one extra field, `allowed-tools`, which names the few commands each skill needs (`node ...` for the scanner and the case-mix helper). Claude Code reads it and Codex ignores fields it does not know (checked with Codex CLI 0.154). In our test, `claude -p` under `--permission-mode acceptEdits` still asked for approval on the scanner command, so for headless runs pass the tools yourself:

```sh
claude -p "is my app ready to launch?" --allowedTools "Skill" "Read" "Write" "Glob" "Grep" "Bash(node *)" "Bash(npx *)"
claude -p "try to break my app and write test cases" --allowedTools "Skill" "Read" "Write" "Edit" "Glob" "Grep" "Agent" "Bash(node *)"
codex exec -s workspace-write "try to break my app and write test cases"
```

Keep `"Skill"` in the list: without it, headless Claude Code denies the skill call and may report that the skill failed to load. A headless `production-readiness` run takes about 3 to 8 minutes and costs roughly $0.5 to $0.8 in Claude Code (about 40k to 55k tokens in Codex). It writes `PRODUCTION_READINESS.md` without asking, and it never installs dependencies or runs your tests, linter or build.

Interactive users just approve the prompts. There is no plugin manifest yet.

## What the scanner checks

| Finding | Severity | What it looks for |
| --- | --- | --- |
| `service-role-in-client` | HIGH | A Supabase `service_role` JWT or `sb_secret` key, or a reference to `SUPABASE_SERVICE_ROLE_KEY`, in browser code (`sb_publishable_` keys are public and not flagged) |
| `public-env-secret` | HIGH | A variable with a public prefix (`NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, `REACT_APP_`) whose name contains SECRET, SERVICE_ROLE, PRIVATE, SK_LIVE, SK_TEST or STRIPE_SECRET |
| `committed-env-file` | HIGH (MEDIUM for `.env.test` and `.env.ci` without a secret-shaped value) | A `.env*` file (other than `.env.example`-style templates and `.env.vault`) that git tracks |
| `stripe-secret-key` | HIGH for `sk_live_` and `rk_live_`, MEDIUM for test keys | A Stripe secret key in any source file |
| `stripe-webhook-unverified` | HIGH | A Stripe webhook handler when nothing in the project calls `constructEvent` (MEDIUM if another file does) |
| `gitignore-missing-env` | HIGH for an env file on disk that no `.gitignore` rule covers (MEDIUM for `.env.test`/`.env.ci`), LOW if there is no env file and `.env` is not ignored | `.gitignore` coverage of every env file |
| `service-role-hardcoded` | MEDIUM | A `service_role` JWT or `sb_secret` key hard-coded in server code, or in a file the scanner cannot place on the server or the browser |
| `stripe-webhook-secret` | HIGH | A Stripe webhook signing secret (`whsec_`) in source |

Values are masked: you see at most the first four characters. It skips `node_modules`, `.git`, build output (`dist`, `build`, `out`, `.next` and similar), binary files and anything over 1 MB.

How it decides a file is browser code, in order: `import "server-only"` or a `"use server"` directive means server; a `"use client"` directive at the top of the file (after any comments) means client; a path containing `api`, `server`, `functions`, `scripts`, `supabase`, `prisma`, `test`, `tests`, `__tests__` or `e2e`, or a file named `route.ts`, `middleware.ts` or `*.server.ts`, means server; `public/` means client. In a Next.js project (`next` in `package.json`), a file under `app/`, `pages/` or `components/` is server code if it uses `getServerSideProps`, `getStaticProps` or `getStaticPaths`, and otherwise "unknown", because Next.js runs it on the server unless it says `"use client"`. A hard-coded service-role key in an unknown file is a MEDIUM, not a HIGH. In other projects a path containing `app`, `pages` or `components` means client, and in a Vite, Create React App or Expo project anything under `src/` means client.

Env files are `.env`, `.env.*` and `*.env`, except `.env.example`-style templates (`.example`, `.sample`, `.template`, `.dist`, `.defaults`) and encrypted `.env.vault`. Every env file on disk must be covered by `.gitignore`, not just `.env`. A tracked `.env.test` or `.env.ci` is MEDIUM unless it holds a secret-shaped value. Obvious placeholders (`sk_live_xxxxxxxx`, `YOUR_KEY`, `<paste-key>`) and names that appear only in code comments are ignored.

The scanner runs `git` read-only to list tracked files and check ignore rules, with the project's own git config (`core.fsmonitor`, hooks) switched off. If git is missing or refuses the folder, the scan still finishes and says so in a note.

## What it does not catch

This is a set of heuristics, not a security audit. It will miss things and it will sometimes flag things that are fine.

- It does not read your git history. A key that was committed once and deleted is still exposed, and the scanner will not see it.
- It does not test your Row Level Security policies. The SQL audit lists suspicious setups, but only signing in as two real users proves a policy works.
- It does not follow imports. A service-role client created in a server file and imported into a client component slips through.
- It does not look inside built bundles, minified files or `.env` values it has no pattern for.
- It does not check authorization logic, rate limits, race conditions, webhook idempotency, backups or anything else that needs a running app. That is what the checklist is for.
- Only Stripe and Supabase patterns are covered.

A clean scan means these particular mistakes are not there. It does not mean the app is ready.

## Tests

```sh
npm test
```

Uses the built-in `node:test` runner. Fixtures in `scan/test/fixtures/` contain deliberately fake keys.

## License

MIT, see [LICENSE](LICENSE). Use it, copy it, hand it to your team.

---

Built by [First Mate Technologies](https://www.firstmate.tech/?utm_source=github&utm_medium=referral&utm_campaign=finish-kit).

Stuck at 80%? Our [vibe-code rescue](https://www.firstmate.tech/vibe-code-rescue?utm_source=github&utm_medium=referral&utm_campaign=finish-kit) starts with a two-week finish trial, and a free 30-minute app review.
