# Templates

## qa/REQUIREMENTS.md

```markdown
# Requirements: <app name>

Derived from: <README, routes, schema, ...> on <date>. Status: <confirmed by user | unconfirmed, see Assumptions>

## Roles
- guest: not logged in
- user: logged in, owns their own records
- admin: can see and change everything

## Behaviors
- R-01 A user can create a booking for a future slot. Max 3 active bookings per user.
- R-02 A user can edit or cancel only their own bookings.
- R-03 Notes are optional, up to 500 characters.

## Money and data flows
- R-10 Payment succeeds only after the webhook confirms it. Retries must not charge twice.

## Stated limits
- Name 1-80 characters, phone in E.164, slots every 30 minutes, venue time zone Asia/Manila.

## Assumptions
- A-1 Cancelling inside 24 hours is allowed (not stated anywhere; guessed).
```

## qa/SURFACE.md

Public surface only: what a tester can see and call. No code, no internal function names.

```markdown
# Surface
## Pages: /, /bookings, /bookings/new, /admin (admin only)
## API
- POST /api/bookings  body: name, phone, slot (ISO), notes. Roles: user.
- PUT /api/bookings/:id  Roles: owner, admin.
## Time zone: slots are shown in the venue time zone.
```

## qa/TEST_CASES.md

Header, then one block per case, grouped into areas with a letter (A auth, B bookings, C admin, ...). Keep this shape exactly; `scripts/case-mix.mjs` parses it.

```markdown
# Test cases: <app>
Designed by: designer: <model name>, builder: <model name from the session header>. Independence: <level>.

## Area B: Bookings

### B-013: Midnight booking groups under the right day
- **Priority:** P0
- **Type:** timezone
- **Traces to:** R-01
- **Preconditions:** Venue time zone Asia/Manila. Browser time zone UTC.
- **Steps:**
  1. Create a booking for today 23:55 venue time.
  2. Create another for tomorrow 00:15 venue time.
  3. Open the Today and Upcoming tabs.
- **Expected:** The 23:55 booking is under Today. The 00:15 booking is under Upcoming (tomorrow), even though its UTC date is today. Any other grouping is a FAIL.
```

Rules for the designer:
- Types are exactly: `happy`, `edge`, `negative`, `boundary`, `security`, `concurrency`, `timezone`, `role`.
- Priority: P0 = data loss, money, security, or a core flow broken. P1 = important flow wrong. P2 = polish.
- Expected results are checkable: name the status code, message, row count or visible text. Never "works correctly".
- Each requirement R-xx has at least one non-happy case.
- Where the requirement is ambiguous, write the case as a question: "Record whether the UI gives any cue" and mark it type `edge` with `Expected: record the behavior, ask the owner`.
- Say what the case hunts when it is a known bug class (UTC date vs venue day, missing ownership check, double submit).

## qa/DEFECTS.md

```markdown
# Defects: <app>
Filed against commit <sha or "uncommitted"> on <date>. No fixes applied while filing.

### DEF-001: Editing another user's booking succeeds
- **Case:** B-021
- **Severity:** S1 (S1 data loss/security/money, S2 core flow wrong, S3 minor, QUESTION needs an owner decision)
- **Status:** OPEN (OPEN, FIXED, STILL FAILING, WONTFIX)
- **Repro:** 1. Log in as user A, note booking id 7 owned by B. 2. PUT /api/bookings/7 with a new name.
- **Expected:** 403, booking unchanged.
- **Actual:** 200, name changed.
- **Evidence:** test output, response body, `file:line` of the handler if you read it. No secrets.
```
