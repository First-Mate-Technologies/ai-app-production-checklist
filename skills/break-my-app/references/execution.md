# Execution, provider guard and defects

Only after the user confirms. Work in a local or throwaway environment.

## 1. Detect the runner

Check `package.json` scripts and devDependencies, `playwright.config.*`, `vitest.config.*`, `jest.config.*`, `pytest.ini` / `pyproject.toml`. Use what exists and follow the existing test file conventions and folders.

No runner: propose Playwright for browser flows and Vitest for logic and API checks, and ask before installing. Zero-dependency fallback for a Node app: `node --test` with `fetch` against a locally started server.

## 2. Which cases first

All P0 cases, then P1 by severity, up to a hard cap of 60 generated tests per run (tell the user the number). List every case beyond the cap as `NOT RUN (over the 60-test cap)`. No single test may wait more than about 10 seconds: use fake timers or short timeouts and mock providers that fail fast instead of waiting 60 s. Keep the case ID in each test name (`B-013 midnight booking groups under the right day`) so failures map back to `qa/TEST_CASES.md`. Skip cases that need a real third party or production and mark them `NOT RUN` with the reason.

## 3. Provider guard

Tests must never reach a real provider. Real examples of what goes wrong: an E2E run that mailed a live inbox because a real API key sat in the local env file, and fake addresses that bounced and hurt the sending domain.

- Start the app for tests with provider variables blanked or pointed at mocks (`STRIPE_SECRET_KEY=""`, `RESEND_API_KEY=""`, `OPENAI_API_KEY=""`, SMS keys). Do not inherit the developer's `.env.local` wholesale.
- Use test-mode keys only if the user explicitly provides them, and prefer a local mock server or the provider's test fixtures.
- Add one guard test: with the test env, the app must use mock adapters (or fail closed) and no outbound request to a real provider host happens. Prefer a guard in the app that refuses to build live providers outside production.
- Point the database at a throwaway instance (local SQLite file, local Docker Postgres, a temp schema). Never at a shared or production database. Check the connection string target before any write and never print it.
- Use fixture data created by the tests themselves, with reserved domains such as `@example.com` only against mocks.

Run the suite as one plain command with output sent to a file, for example `node --test qa/tests/ > qa/test-run.log 2>&1`, then read the log. Pipes and `&&` chains can be denied in headless runs. Keep scratch files under `qa/`, not `/tmp`.

## 4. RED first

Run the tests against the unmodified code and record every failure. Do not edit app code to make a test pass at this stage. If a test fails because the test is wrong (bad assumption, wrong selector), fix the test and say so; if it fails because the app is wrong, it is a defect.

## 5. File defects

For each distinct failure create an entry in `qa/DEFECTS.md` (template in `templates.md`) before touching the app. Merge failures with the same root cause into one defect and list all case IDs. Severity: S1 data loss, security hole or money wrong; S2 core flow broken or wrong; S3 minor; QUESTION when the requirement is unclear and the owner must decide.

## 6. Fix loop (only with confirmation)

Ask which defects to fix. For each one, one at a time: make the smallest change, re-run that test (it should turn green), then the full suite (nothing else should break), then set the status to `FIXED` with a one-line note, or `STILL FAILING`. Keep the failing test as a permanent regression test.

## 7. Report

Counts: cases designed, tests written, passed, failed, not run. Defects by severity. Anything that could not be tested without a real provider or production.
