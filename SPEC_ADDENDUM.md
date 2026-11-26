# GigHold — Spec addendum v0.3 (add-on modules)

*Status: **v0.3, 2026-11-24.** `SPEC.md` v1.2 is unchanged, still frozen, and still defines v1. This file defines what is built after v1.*

*A1 and A2 are approved. A3 to A7 are in scope as outlines; each gets a full contract, checked against the official docs, before it is built. Blake delegated the contract details and the choice of modules; every choice marked **Decision** below was made on his behalf and is his to overrule.*

*Claim labels, as in SPEC.md: **Sourced** (link in the module's facts section) · **From memory** (must be checked against the official docs at the step that uses it) · **Decision** (a choice made in this file).*

| Module | What it is | Contract status |
|---|---|---|
| **A1** | Structural guard test | APPROVED 2026-11-24 |
| **A2** | Band sign-in and row level security | APPROVED 2026-11-24 |
| **A3** | The toolkit: a second app in Express and React (Vite) | Outline. Full contract before it is built |
| **A4** | Money operations | Outline. Full contract before it is built |
| **A5** | AI-assisted booking message | Outline. Full contract before it is built |
| **A6** | Error monitoring | Outline. Full contract before it is built |
| **A7** | HubSpot deal sync | Stretch. Outline only |

---

## 0. Rules for every add-on

1. **v1 first.** No add-on starts until v1 meets SPEC §14 and that commit is tagged `v1.0`.
2. **One module at a time, each with its own approval.** A module is built only after its section here is marked APPROVED. Once approved, the section is frozen like SPEC.md; new ideas go to `PARKING_LOT.md`.
3. **SPEC.md does not change.** Where a module replaces something v1 does, its section says so under "Replaces in v1". SPEC.md stays as the record of v1.
4. **Branches.** A1 is one test file and goes straight to `main`. Every other module is built on its own git branch and merged into `main` only after its acceptance checks pass locally. `main` deploys to production, so production never holds a half-built module.
5. **Additive database changes only.** A new migration may add tables, columns, policies, grants and new functions. It may not drop, rename or change the behavior of anything v1 uses, because the live v1 app shares the database until the module is merged. Every migration gets a `BEGIN; … ROLLBACK;` dry run first, and migrations stay fix-forward (SPEC §6).
6. **The repo always matches the database.** If a module is abandoned after its migration has run, the migration file is still merged.
7. **No v1 test is weakened or removed** to make an add-on pass. Where a module replaces v1 behavior, the replaced check is named in "Replaces in v1".
8. **Dependencies.** Each module lists its own additions. Anything else needs Blake's approval and a line in `PARKING_LOT.md` (SPEC §13).
9. **Every CLAUDE.md hard rule still applies.** When add-on work starts, `CLAUDE.md` is updated to name this file as the source of truth for add-ons.
10. **Each module ends like a milestone:** merged, pushed, the build green, and a check on the live site.
11. **A fixed order.** Modules are built in number order. A module that would not fit before the final feature freeze is not started.
12. **A second repository.** The toolkit (A3) lives in its own repository, `gighold-toolkit`, with its own `SPEC.md` and `CLAUDE.md`. These rules apply there too.
13. **A change record per module.** Each module adds a short file under `docs/changes/`: what was asked, what the agent did, what Blake checked himself, and how to roll it back.

---

## A1 — Structural guard test

**Contract status: APPROVED 2026-11-24.**

### Purpose

SPEC §8 says app code never updates or deletes `bookings`; every status change goes through the database functions. Test D7 proves the database refuses such a write. A1 adds the other half: a test that fails when the code so much as tries, before anything runs.

### In scope

One new test file, placed beside the other unit tests. It holds two tests.

- **G1: no direct writes to `bookings`.** Scans every `.ts` and `.tsx` file under `app/` and `lib/`, plus `proxy.ts`. It fails, naming each file and line, if it finds either pattern:
  1. A supabase-js call chain that starts at `.from('bookings')`, in any quote style, and reaches `.update(`, `.delete(` or `.upsert(` before the statement ends. Line breaks inside the chain don't hide it.
  2. SQL text that updates or deletes the table: `update bookings`, `update public.bookings`, `delete from bookings` or `delete from public.bookings`, in any letter case.
- **G2: the guard can fail.** Runs the same scanner over sample strings held in the test itself. One forbidden sample of each pattern must be flagged. Two allowed samples must pass: an insert into `bookings`, and an update of a different table.

### Not scanned

`supabase/migrations/` (the SQL that legitimately changes the table lives there) and test files.

### Out of scope

A code parser, a lint rule, and any new dependency. This is a text scan using Node's built-in file modules.

### Known limit

A text scan can be evaded, for example by putting the table name in a variable. D7 remains the enforcement. G1 is the early warning that shows up in `npm test`.

### Dependencies added

None.

### Acceptance

- `npm test` is green, with G1 and G2 listed.
- Manual proof: add a forbidden line to a scratch file under `lib/`, run `npm test`, see G1 fail and name that file, then delete the file.

### Replaces in v1

Nothing.

---

## A2 — Band sign-in and row level security

**Contract status: APPROVED 2026-11-24.** Facts were checked against the Supabase docs the same day; the links are in A2 §14.

### A2 §1 Purpose

Replace the one shared admin password with a sign-in per person, and let the database decide which bookings each signed-in person can see and act on.

After A2, the admin screen never touches the secret key. Everything it reads or does runs as the signed-in person, and the database checks each call.

### A2 §2 Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The unit of ownership is the **band**. Two bands exist. | Isolation can't be shown, or tested, with one |
| 2 | The booking form is unchanged. Every new booking goes to the first band through a column default. | Keeps the public flow, and the live v1 app, working without a code change |
| 3 | People sign in with **email and password**. Blake creates both accounts by hand, then turns sign-ups off. | No sign-up page, no password reset and no email to build |
| 4 | **No Supabase client runs in the browser.** Sign-in and sign-out are Server Actions. | v1 never read the database from the browser; A2 keeps it that way |
| 5 | `/admin` reads **as the signed-in person**, through a session client. Admin code does not import the secret-key client. | Row level security decides what comes back, not app code |
| 6 | Approve and Decline call **two new wrapper functions** that check band membership and then hand off to v1's `begin_capture` and `begin_cancel`. The v1 functions are not changed. | The membership check lives in the database, and the compare-and-set stays in one place |
| 7 | The proxy and the page verify the session with `getClaims()`. The Approve and Decline actions use `getUser()`. | `getClaims()` checks the token's signature; only `getUser()` notices a session that was ended elsewhere, and the money actions are where that gap matters. *Sourced* |
| 8 | Policies check membership with a plain subquery on `band_members`. No helper function. | Two tables, no recursion, and the SQL reads the way the rule is said aloud |
| 9 | `service_role` keeps its EXECUTE on `begin_capture` and `begin_cancel`. | Production can be rolled back to `v1.0`. See A2 §12 |

### A2 §3 Routes and files

| Route / file | Change |
|---|---|
| `/admin/sign-in` | **New** page, public. Email and password form inside a `bwai-card`, built with the `bwai-brand` skill. One generic message for any failed sign-in |
| `/admin` | Needs a session. Reads bookings and events through the session client. Shows the band's name and a Sign out button. A signed-in person with no band sees a plain message and no data |
| Sign-in and sign-out | **New** Server Actions. Sign-in always redirects to `/admin`, never to an address taken from the request |
| Approve and Decline actions | Check the session with `getUser()`, then call the wrapper functions through the session client. The Stripe calls and their idempotency keys are unchanged |
| `proxy.ts` | Basic Auth is replaced by the session check. It runs on `/admin` and everything under it, and lets `/admin/sign-in` through |
| Session client module | **New**, server-only. Built to Supabase's current guide for Next.js |
| `lib/adminAuth.ts` | **Removed** |
| `/`, `/thanks`, `/api/stripe/webhook` | Unchanged. They keep using the secret key |

**Copy the cookie handling from Supabase's guide; don't write it from memory.** The helper package is still labeled beta. *Sourced.*

### A2 §4 Data model

Migration `supabase/migrations/0002_bands_and_rls.sql`. Everything in it is additive (§0, rule 5).

**`public.bands`**

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | not null |

Two rows are inserted by the migration, with fixed ids written as literals.

**`public.band_members`**

| Column | Type | Rules |
|---|---|---|
| `user_id` | uuid | not null, references `auth.users (id)` on delete cascade |
| `band_id` | uuid | not null, references `public.bands (id)` |

Primary key `(user_id, band_id)`. Rows are inserted by hand in the SQL Editor once the two accounts exist. They are environment data, so they are not in a migration, and no email address appears anywhere in the repo.

**`public.bookings`** gains one column:

| Column | Type | Rules |
|---|---|---|
| `band_id` | uuid | not null, default the first band's id, references `public.bands (id)`; indexed |

Existing rows take the default. v1 inserts don't name the column, so they take it too.

`band_id` cannot change after insert: no role holds UPDATE on `bookings`, and none of the database functions touches the column.

### A2 §5 Policies

RLS is enabled on the two new tables. Every policy is for SELECT, and every policy names the `authenticated` role.

| Table | A signed-in person can read a row when… |
|---|---|
| `band_members` | it is their own membership row |
| `bands` | they are a member of that band |
| `bookings` | they are a member of the booking's band |
| `stripe_events` | the event's `booking_id` points at a booking they can read |

- The caller's id is read as `(select auth.uid())`. *Sourced.*
- The `bookings` rule is a subquery on `band_members`. That subquery is itself filtered by the `band_members` policy, which is why that table needs one. *Sourced.*
- The `stripe_events` rule leans on the `bookings` policy the same way. Events with no `booking_id` are visible to no signed-in person.
- No policy allows INSERT, UPDATE or DELETE on any table.
- `anon` gets no policy and no grant. D6 still holds.

### A2 §6 Functions

Two new functions. Both are `SECURITY DEFINER` with `SET search_path = ''`, and every object inside them is schema-qualified, the same as SPEC §7.

**`public.begin_capture_as_member(p_booking_id uuid) returns text`**

1. Read the caller's id with `auth.uid()`.
2. If there is no caller, no such booking, or the caller is not a member of the booking's band: return `NULL` and change nothing.
3. Otherwise return `public.begin_capture(p_booking_id)`.

**`public.begin_cancel_as_member(p_booking_id uuid) returns text`** is the same, ending in `public.begin_cancel(p_booking_id)`.

`NULL` covers "not yours", "not there" and "no longer authorized" alike. The action shows one message for all three and doesn't say which.

**Why these sit in `public`.** Supabase's guidance is to keep security definer functions out of any schema the Data API exposes, because whoever can reach the API can call them with the owner's rights. *Sourced.* These two are the exception on purpose: they are the API. Each one checks the caller before it does anything, and EXECUTE goes to `authenticated` alone.

### A2 §7 Grants

Revoke first, then grant, as in SPEC §8.

- `REVOKE ALL` on `bands` and `band_members` from `anon`, `authenticated` and `service_role`.
- `REVOKE EXECUTE` on both new functions from `PUBLIC`, `anon`, `authenticated` and `service_role`.
- `authenticated` gets `SELECT` on `bands`, `band_members`, `bookings` and `stripe_events`, and `EXECUTE` on the two new functions. Nothing else.
- `service_role` gets nothing new.
- **No role gains UPDATE or DELETE on anything.** A signed-in person cannot call `begin_capture`, `begin_cancel` or `apply_stripe_event` directly. D11 proves both.

### A2 §8 Session rules

- The session is checked in three places, as in v1: the proxy, the top of the `/admin` page before it reads anything, and inside every admin action.
- **It fails closed.** A missing `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY`, an error from the session check, or a token that doesn't verify all mean "not signed in".
- The allow-or-deny decision is one small function with no network call in it, so it can be unit tested (U4). The proxy, the page and the actions each fetch the session their own way and pass the result to it.
- Being signed in is not the same as having access. Which rows a person sees is the database's decision (A2 §5), and a signed-in person with no band sees nothing.

### A2 §9 Supabase project settings

Done by Blake in the dashboard, in this order:

1. Create two users, each with a password and confirmed at creation. *From memory: Authentication → Users → Add user → Create new user, with an auto-confirm option.*
2. Turn off "Allow new users to sign up". *Sourced.* With it off, only existing users can sign in.
3. Copy the publishable key.

### A2 §10 Environment variables and dependencies

| Name | Local | Vercel | Secret? | Change |
|---|---|---|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | same | no | **Added.** Server-side only, so it has no `NEXT_PUBLIC_` prefix |
| `ADMIN_USER`, `ADMIN_PASSWORD` | — | — | yes | **Retired** from code and `.env.example` |

Supabase's guide names its variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, because it also builds a browser client. *Sourced.* This app has no browser client (decision 4), so it keeps v1's `SUPABASE_URL` and adds `SUPABASE_PUBLISHABLE_KEY`. Don't rename either to match the guide.

**Dependency added:** `@supabase/ssr`, pinned to an exact version. It is the package Supabase names for cookie-based sessions in Next.js. *Sourced.* Nothing else is added.

### A2 §11 Tests

**Unit**

- **U4:** the access decision function denies when there is no verified session and when the Supabase settings are missing, and allows only a verified session.

**Database** (same rolled-back `pg` setup as D1–D7). A helper acts as a signed-in person by switching to the `authenticated` role and setting that person's id as the request's subject claim. *Sourced.* Each test creates its own users, memberships and bookings inside its transaction.

- **D8:** a member of band A reads band A's test booking and its webhook event, and reads neither band B's booking nor its event.
- **D9:** a member of band A calls `begin_capture_as_member` on band B's authorized booking and gets `NULL`; the booking is unchanged. On their own band's authorized booking the same call returns the PaymentIntent id and the status becomes `capture_pending`.
- **D10:** a signed-in person with no membership reads no bookings and gets `NULL` from both wrapper functions.
- **D11:** a signed-in member is refused, with a permission error, on a direct `UPDATE` of `bookings` and on a direct call to `begin_capture`.
- D1–D7 still pass unchanged.

*From memory: the hosted database lets these tests insert rows into `auth.users` inside a rolled-back transaction, as Supabase's own test examples do. If it refuses, stop and tell Blake.*

**Manual, local**

- **S1:** with no session, `/admin` sends you to `/admin/sign-in`.
- **S2:** the first band's person signs in, sees that band's bookings, and approves one. Stripe shows one capture.
- **S3:** the second band's person signs in, in a private window, and sees no bookings.
- **S4:** a wrong password stays on the sign-in page with the generic message.
- **S5:** after Sign out, `/admin` sends you to sign-in again.
- E1 and E3 from SPEC §11 are run again under sign-in.

**Live on Vercel**

- **L4** = S1, S2 and S3 on the live site.

### A2 §12 Replaces in v1, and what stays

**Replaced**

- SPEC §3: `/admin` access is a signed-in session, not Basic Auth. `/admin/sign-in` is a new route.
- SPEC §4: "User accounts or Supabase Auth" and "multiple bands" come into scope, within the limits in A2 §13.
- SPEC §8: RLS now has SELECT policies for `authenticated`; the two admin-access bullets are replaced by A2 §8.
- SPEC §12: `ADMIN_USER` and `ADMIN_PASSWORD` are retired; `SUPABASE_PUBLISHABLE_KEY` is added.
- SPEC §13: `@supabase/ssr` is added.
- CLAUDE.md rule 8 gains the two wrapper functions; rule 12 describes the session check. Both are edited as part of this module.

**Stays**

- The three check points and the fail-closed rule.
- The state machine, the trigger, the three v1 functions and every v1 grant.
- The webhook, the booking form and the "can't charge twice" layers in SPEC §10.

**Known limits after A2**

- The secret key can still call `begin_capture` and `begin_cancel` directly. Revoking that is a one-line migration. It is left out so production can be rolled back to `v1.0`, where the admin screen depends on it.
- The page and the proxy trust a verified token until it expires, so a session ended on another device is noticed by the money actions before it is noticed by the page (decision 7).

### A2 §13 Out of scope

Sign-up, password reset, magic links, social sign-in, multi-factor sign-in, roles inside a band, a band picker on the booking form, prices per band, a screen for managing members, rate limiting beyond what Supabase Auth applies itself, and a Supabase client in the browser.

### A2 §14 Facts this contract depends on

**Sourced, read 2026-11-24**

- **Which package.** For sessions kept in cookies by a framework like Next.js, Supabase names `@supabase/ssr`. Source: [Which package to use](https://supabase.com/docs/guides/auth/choosing-a-server-package).
- **File layout, the proxy, and which check to use.** The current guide is written for `proxy.ts`; it uses a server client and a proxy helper that refreshes the session; it says to protect pages with `getClaims()`, and that Server Components can't write cookies, which is why the proxy refreshes them. Source: [Creating a Supabase client for SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- **`getClaims()` vs. `getUser()`.** `getClaims()` verifies the token's signature, locally on projects with asymmetric signing keys, which is the default for new projects. Only `getUser()` detects a session that ended elsewhere. Sources: [getClaims reference](https://supabase.com/docs/reference/javascript/auth-getclaims), [SSR advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide).
- **The package is labeled beta.** Source: [Server-Side Rendering](https://supabase.com/docs/guides/auth/server-side).
- **Sign-in from a Server Action** with `signInWithPassword`, using the server client. Source: [Build a User Management App with Next.js](https://supabase.com/docs/guides/getting-started/tutorials/with-nextjs).
- **Policy syntax,** `to authenticated`, `(select auth.uid())`, and `auth.uid()` returning null when no one is signed in. Source: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- **Membership through a subquery on a second table.** Source: [Row Level Security performance](https://supabase.com/docs/guides/database/postgres/row-level-security-performance).
- **Security definer functions:** fixed `search_path`, schema-qualified names, and the warning about exposed schemas. Source: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
- **Grants** to `authenticated` for tables and functions, and EXECUTE going to `PUBLIC` by default. Source: [Securing your API](https://supabase.com/docs/guides/api/securing-your-api).
- **Acting as a signed-in person in SQL:** switch to the `authenticated` role and set the subject claim; Supabase's examples insert test users into `auth.users` inside a rolled-back transaction. Source: [Test Row Level Security policies with pgTAP](https://supabase.com/docs/guides/database/postgres/testing-row-level-security).
- **"Allow new users to sign up":** when off, only existing users can sign in. Source: [General configuration](https://supabase.com/docs/guides/auth/general-configuration).

**From memory — to verify at the step that uses them**

- The dashboard's Add user dialog can set a password and confirm the user at creation. Supabase's Users page documents only invitations; a [GitHub issue](https://github.com/supabase/auth/issues/1226) describes the dialog. (step A2.0)
- Turning sign-ups off does not stop the dashboard from creating users. The two users are created first, so it doesn't matter. (step A2.0)
- The hosted `postgres` role can insert into `auth.users` in a rolled-back transaction, as the local test examples do. (tests D8–D11)
- `auth.uid()` returns the caller's id inside a security definer function called through the Data API. Supabase's examples call it that way; D9 proves it here. (step A2.1)
- The Security Advisor does not flag a security definer function in `public` whose EXECUTE is limited to `authenticated`. If it does, stop and tell Blake. (step A2.2)

---

## A3 — The toolkit: a second app in Express and React (Vite)

**Contract status: outline.** The full contract is written as the toolkit repository's own `SPEC.md`, and its facts are checked against the official docs, before the module is built.

### Purpose

A second, separate application that GigHold can call: a small internal toolkit that drafts short messages with an LLM. It is built on a different stack from GigHold on purpose, an Express server and a React page bundled by Vite, and it is hosted somewhere else.

### Proposed shape

- **Its own repository,** `gighold-toolkit`, with its own spec, rules file, tests and host.
- **An Express server in strict TypeScript,** with two routes:
  - a copy route that takes a few facts about an event (the occasion, the date, a tone, and a short note) and returns one drafted message with a fixed maximum length;
  - a health route that reports the commit that is running.
- **The LLM call** goes to Anthropic's API. The model name comes from an environment variable. The caller's text is passed as data inside clear delimiters and is never treated as instructions. The output is capped, and the call has a timeout.
- **Access.** The copy route accepts a key shared with GigHold's server. If that key is not configured, every call is refused.
- **A workbench page,** built with React and Vite and served by the same server: a form to try the copy route, showing the draft, the time taken and the tokens used. It sits behind one shared user name and password.
- **Limits.** A rate limit in the server, and a monthly spend limit set at the provider.
- **Protections.** Strict type checks, unit tests, and a verified deploy: after each deploy, the health route's commit must match the commit that was pushed.
- **Hosting:** Render, as one web service.

### Proposed tests

- **T1:** input that is missing a field or too long is rejected before any LLM call.
- **T2:** the prompt builder keeps the caller's text inside its data delimiters.
- **T3:** a call without the key is refused, and every call is refused when the key is not configured.
- **T4:** an LLM call that times out returns a clean error and does not hang.
- **T5:** the copy route returns a draft when given a stand-in LLM client.

### Likely additions

*From memory; confirmed or corrected when the contract is written.*

- Dependencies: `express`, `@anthropic-ai/sdk`, `react`, `react-dom`, `vite` and its React plugin, `typescript`, `vitest`.
- Environment variables: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `TOOLKIT_API_KEY`, `WORKBENCH_USER`, `WORKBENCH_PASSWORD`.

### Out of scope

Sign-in accounts, a database, saved drafts or history, streaming responses, batch jobs, retrieval, and any key held in the browser.

### To check against the docs before the contract is written

1. The current Express major version and its TypeScript setup.
2. Vite's React and TypeScript template, and how one server serves both the built page and the API.
3. Render: build and start commands for a Node web service, what the free plan does when idle, and how a running service learns its commit.
4. Anthropic's SDK: structured output, timeouts and output limits.

---

## A4 — Money operations

**Contract status: outline.**

### Purpose

v1 leaves three things to a person: noticing a hold that is about to expire, closing a booking whose checkout was abandoned, and finding a booking that disagrees with Stripe. A4 has the app do all three.

### Proposed shape

- **Hold-expiry warning.** The admin page marks any `authorized` booking whose hold has two days or less to run, in words, and lists those first. No schema change.
- **Abandoned checkouts.**
  - The Checkout Session carries the booking id, as the payment already does.
  - The webhook also handles Stripe's "Checkout Session expired" event.
  - A new version of `apply_stripe_event` maps that event from `pending_payment` to `canceled`, and ignores it in any other status. The state machine already allows that move; no status and no arrow is added.
- **Daily reconciliation.**
  - A scheduled job, and an admin action that runs the same job on demand.
  - For each booking that is not finished, it reads Stripe's own record of the payment and compares the two.
  - It writes one row per run and one row per finding. **It changes no booking.**
  - The admin page shows when the job last ran and what it found.
  - The scheduled route refuses any request that does not carry its own secret.
- Signed-in people see findings for their own band's bookings only.

### Proposed tests

- **D12:** the session-expired event moves `pending_payment` to `canceled`, and is ignored in every other status.
- **D13:** a member reads reconciliation findings for their own band and no other.
- **U5:** the comparison function returns the right result for each pairing of booking status and Stripe status.
- **U6:** the scheduled route refuses a request without its secret.
- **E6:** start a checkout, abandon it, expire the session. The booking becomes `canceled`.
- **E7:** on clean data the job reports no findings. With one booking deliberately put out of step, it reports that one, and the booking is unchanged.

### Replaces in v1

- SPEC §2: the known gap for abandoned checkouts is closed.
- SPEC §4: "Automated jobs for expiring holds; checkout-expiry handling" and "Cleanup of abandoned `pending_payment` bookings" come into scope.
- SPEC §7: the `apply_stripe_event` mapping gains one row.
- SPEC §9: four events are handled, not three.

### Out of scope

Repairing a mismatch automatically, a retry for a failed capture, alerts by email, and refunds.

### To check against the docs before the contract is written

1. Stripe's Checkout Session expiry: the event, the default lifetime, and how to expire a session by hand for a test.
2. Whether metadata set on the Session is separate from metadata set on the payment.
3. Vercel's scheduled jobs on the Hobby plan: how often they may run, and how a route confirms the caller is the scheduler.
4. The list of PaymentIntent statuses.

---

## A5 — AI-assisted booking message

**Contract status: outline.** Depends on A3.

### Purpose

The booking form offers to draft the customer's note by calling the toolkit. The booking never depends on that call succeeding.

### Proposed shape

- `bookings` gains an optional `message` column, with a fixed maximum length.
- The form gains an optional message box and a "Draft it for me" button.
- The button calls GigHold's server, which calls the toolkit with the shared key and a short timeout. The key never reaches the browser.
- **If the toolkit is slow or unavailable, the customer sees a plain notice and can type their own message or leave it blank.** Checkout is never blocked.
- The admin page shows the message. It is not sent to Stripe.

### Proposed tests

- **U7:** the toolkit client returns a fallback result on a timeout, a network error and a non-success response, and never throws.
- **E8:** a draft appears on the form and is saved with the booking.
- **E9:** with the toolkit stopped, a booking completes end to end.

### Likely additions

Environment variables `TOOLKIT_URL` and `TOOLKIT_API_KEY`. No new dependency.

### Replaces in v1

- SPEC §3: the form gains a field.
- SPEC §4: "AI-assisted copy" comes into scope.
- SPEC §6: `bookings` gains `message`.

### Out of scope

Several suggestions to choose from, saving drafts, and editing the message after booking.

---

## A6 — Error monitoring

**Contract status: outline.**

### Purpose

A server error reaches a person without anyone reading a log.

### Proposed shape

- Sentry's SDK on GigHold's server.
- The webhook and the admin actions report failures, tagged with the booking id.
- **No customer name or email is sent.** A scrubber removes them before anything leaves the app.
- Set up by hand from Sentry's guide for Next.js, not by its setup wizard.
- A test action, behind sign-in, that raises a deliberate error.

### Proposed tests

- **U8:** the scrubber removes customer fields from an event.
- **L5:** the test error on the live site arrives in Sentry, with the booking id and without customer data.

### Likely additions

Dependency `@sentry/nextjs`. Environment variable `SENTRY_DSN`.

### Out of scope

Monitoring in the browser, performance tracing, session replay, and monitoring the toolkit.

---

## A7 — HubSpot deal sync (stretch)

**Contract status: outline only.** A contract is written only if this module starts.

### Purpose

Each booking appears as a deal in a CRM and follows the booking's status.

### Proposed shape

- A trigger queues every status change in an outbox table, in the same transaction as the change.
- A worker, scheduled and runnable on demand, sends the queue to HubSpot, creates the deal on first sight and updates it afterward, and records the deal id.
- A failed send is retried. A booking never waits on HubSpot.

---

## Change log

**v0.3 (2026-11-24).** The add-on stage grows from three modules to seven. A3 is the toolkit, A4 money operations, A5 the AI-assisted message, A6 error monitoring, and A7 a stretch. Each is an outline until its full contract is written. Rules 11 to 13 added to §0.

**v0.2 (2026-11-24).** A1 approved. A2's full contract written, checked against the Supabase docs and approved. Rule 5 in §0 now also forbids changing the behavior of anything v1 uses.

**v0.1 (2026-11-24).** First draft. Rules for add-ons; the A1 contract; the A2 outline; the A3 options.
