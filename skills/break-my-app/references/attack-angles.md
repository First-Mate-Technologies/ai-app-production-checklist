# Attack angles by feature type

Pick the sections that match the app. For each requirement ask: what is the least friendly input, user, timing or order that this could meet? Aim for several cases per angle that applies, and mostly non-happy types.

## Forms and input
- Empty, whitespace only, one character, exactly at the limit, limit plus one, 10x the limit, 1 MB.
- Unicode: emoji, RTL text, combining characters, zero-width space, NUL byte (`%00`), very long single word.
- Injection strings: `<script>`, `' OR 1=1 --`, `{{7*7}}`, path traversal, CRLF in header-bound fields.
- Wrong types via the API: number as string, array instead of string, null, missing field, extra field (mass assignment: `role`, `userId`, `price`).
- Double submit and rapid repeat clicks, submit then back button then submit, refresh after POST.
- Client validation bypassed: call the API directly with the invalid payload.
- Negative, zero, fractional and huge numbers; dates in the past, far future, Feb 29, invalid dates.

## Auth and roles
- Logged out access to every protected page and endpoint. Expired or tampered session or token.
- Horizontal: user A reads, edits, deletes user B's record by changing the id (IDOR). Guessable or sequential ids.
- Vertical: normal user calls admin endpoints, sets `role=admin` in a body, hits admin pages by URL.
- Login: wrong password messages that reveal whether an email exists, no lockout, reset links that never expire or can be reused, open redirect after login (`?next=//evil.example`), loses the page you were heading to.
- Logout does not invalidate the session. Two sessions, role changes in one.

## Payments and webhooks
- Webhook with no signature, wrong signature, old timestamp. Same event delivered twice (idempotency). Events out of order. Event for an unknown order.
- Amount, currency or price taken from the client. Coupon reuse, stacking, negative totals.
- Double click on pay, pay in two tabs, refund twice, payment succeeds but the app crashes before saving.
- Partial failure: provider timeout, provider says paid but redirect never returns.

## Uploads
- Zero bytes, huge file, wrong extension with right content and the reverse, double extension, SVG with script, filename with `../`, same name twice.
- Upload by a logged out user, to another user's folder, view another user's file by URL.
- Interrupted upload, parallel uploads, unsupported type message.

## Lists, search and pagination
- Empty list, one item, exactly one page, page size plus one, page 0, negative page, page past the end, huge `limit`.
- Sort ties (stable order across pages), search with `%`, `_`, quotes, empty query, very long query.
- Item deleted or added while paging. Filters combined. Another user's items leaking into the list or counts.

## Time and dates
- Time zone: user zone differs from the server and the venue zone. UTC date vs local date near midnight (23:55 and 00:15).
- DST start and end days, Feb 29, month and year end, week start day, leap seconds in logic that compares equality.
- Past times, now, "in 1 minute", far future. Server clock vs browser clock. Stored as UTC and shown in the right zone.
- Expiry exactly at the boundary (`<` vs `<=`). Recurrence over a DST change.

## Multi-tenant and shared data
- Tenant A's id in tenant B's session on every read and write route. Aggregates, exports, search and notifications that cross tenants.
- Cached responses served to the wrong tenant. Background jobs running without a tenant scope.
- Deleting a tenant or user: orphaned rows, still reachable by id.

## Rate limits, abuse and cost
- Hammer login, signup, password reset, contact form, any endpoint that sends email or SMS or calls a paid API.
- Many accounts from one address, one account from many addresses. Large payloads, deep JSON, huge query strings.
- Enumeration through response timing or messages.

## Concurrency
- Two tabs or two users take the last seat, slot, coupon or stock item at once. Double booking.
- Read-modify-write races (counters, balances). Undo in one tab after another tab changed the same item.
- Retry after timeout creates a duplicate. Optimistic UI that never rolls back when the server rejects.
- Offline then online, stale tab polling forever after the item reaches a final state.

## AI and LLM features
- Prompt injection in user content and in retrieved documents ("ignore previous instructions"), attempts to reveal the system prompt or other users' data.
- Empty input, huge input beyond the context window, non-English, only emoji.
- Provider down, slow, rate limited, returns malformed JSON or an empty string: does the UI recover and avoid double charging?
- Output rendered as HTML or markdown without escaping. Cost caps per user. Streaming cut off midway.
- Same input twice gives different output: assert on properties (valid shape, no leaked secrets, within limits), not exact text.

## Cross-cutting
- Refresh in the middle of a flow, back button, deep link to a mid-flow page, two browsers, mobile viewport, slow network, JavaScript disabled where it should still work.
- Errors: what does the user see on a 500, a timeout, a 404 for a real-looking id? Do error messages leak stack traces or SQL?
- Data retention: deleted data really deleted, PII not in logs or URLs.
