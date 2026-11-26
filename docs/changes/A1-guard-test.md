# A1 — Structural guard test: change record

Contract: `SPEC_ADDENDUM.md`, "A1 — Structural guard test" (approved 2026-11-24).

## 1. What was asked

Add one test file holding two tests. G1 scans every `.ts` and `.tsx` file under `app/` and `lib/`, plus `proxy.ts`, and fails if any of them writes to the `bookings` table directly. G2 proves the scanner can fail, by running it over sample strings held in the test itself. Test D7 stays the enforcement, because it shows the database refusing such a write; A1 is the early warning that shows up in `npm test`.

## 2. What the agent did

It created `tests/guard.test.ts` and changed nothing else. The scanner looks for two patterns:

1. A supabase-js call chain that starts at `.from('bookings')`, in any quote style, and reaches `.update(`, `.delete(` or `.upsert(` before the statement ends. A chain split over several lines is still followed.
2. SQL text that says `update bookings` or `delete from bookings`, with or without the `public.` prefix, in any letter case.

G1 scanned 17 files: 16 under `app/` and `lib/`, plus `proxy.ts`. Before it checks for violations, it asserts that `app/actions.ts` and `lib/supabase.ts` were in the scan, so an empty file list cannot pass quietly. G2 checks seven forbidden samples and two allowed ones (an insert into `bookings`, and an update of a different table). No new dependency was added; the test uses Node's built-in file modules and Vitest.

Known limit: this is a text scan, not a parser. It misses a table name built from pieces, for example one held in a variable. It also errs the other way: a comment that literally says "update bookings" would trip it.

## 3. What Blake checked himself (2026-11-26)

- `npm test` was green: 4 files, 16 tests.
- He added a scratch file, `lib/zz-guard-scratch.ts`, holding `supabase.from('bookings').update(...)`. G1 failed and named `lib/zz-guard-scratch.ts:1` (15 passed, 1 failed).
- He deleted the scratch file, and `npm test` returned to 16 passing.

## 4. How to roll it back

Delete `tests/guard.test.ts` and this file, or `git revert` the A1 commit. Nothing else depends on the test. There is no database change and no deploy change to undo.
