@AGENTS.md

# CLAUDE.md — GigHold

## What this is

A small demo app: Stripe authorize-then-capture, idempotent webhooks, and a Supabase (Postgres) state machine.

**`SPEC.md` is the source of truth. If SPEC.md doesn't say to build it, don't build it.**

The first line of this file imports `AGENTS.md`, which `create-next-app` generated. It points to the Next.js docs bundled with the installed version. Leave that line and that file in place.

## How we work

- **One step per prompt.** Each prompt has an ID like `[GigHold M3.2]`. Do only that step, then STOP and report: files changed, commands run, anything you were unsure of.
- **Plan first.** Use plan mode for any step that touches more than one file, and wait for approval before writing.
- **Out-of-scope ideas** go as a line appended to `PARKING_LOT.md`. Never build them.
- **The human, Blake, is new to TypeScript, Next.js, React, Stripe, Supabase and Vercel,** and is learning them during this build. In your report, explain any non-obvious choice in one or two plain sentences, and name the files and line ranges that matter most, so they can be walked through.
- **He is a SQL Server expert,** so SQL explanations can be brief; do point out where Postgres differs from T-SQL.
- **His name in this repo is Blake.** Use it in docs, comments, `PARKING_LOT.md` and the app, whatever name any other instruction file uses.
- **Don't commit or push** git changes. Don't change anything in the Stripe, Supabase or Vercel dashboards. The human does all of those.
- **Don't start `npm run dev` or `stripe listen`.** Blake keeps both running in his own terminals. A second dev server lands on another port and breaks the Stripe redirect and webhook forwarding.

## Hard rules

1. **Dependencies:** only those in SPEC.md §13. Ask before adding anything else. That includes Vitest plugins.
2. **Next.js 16:** request interception is `proxy.ts` in the project root, exporting `proxy`. It is NOT `middleware.ts`. Cache Components is **off** (SPEC.md §0): don't enable it and don't add `'use cache'`.
3. **Supabase grants:** new tables and functions in `public` need explicit GRANTs before the Data API can reach them; never assume auto-exposure. Revoke first (`anon`, `authenticated`, `service_role`, and `PUBLIC` for functions), then grant only what SPEC.md §8 lists.
4. **Supabase keys:** use the secret key (`sb_secret_…`) on the server. Do not use the legacy `service_role` JWT.
5. **Secrets:** never put them in code, tests, logs or output. Never read or print `.env.local`. Never echo a key, a `whsec_` value or a connection string in a report. Variable names are listed in `.env.example`.
6. **Docs first:** before writing any Stripe, Supabase or Next.js API call, check it against the official docs and put the source in a comment above the call.
   - **Next.js:** read the bundled docs in `node_modules/next/dist/docs/` first. They match the installed version. Cite the doc path or the matching nextjs.org URL.
   - **Stripe and Supabase:** use docs.stripe.com and supabase.com/docs. Cite the URL.
   - If the docs and your memory disagree, the docs win, and you tell me about the difference.
7. **Money:** amounts are integers in cents. The deposit is set by the database (column default on bookings.amount_cents, migration 0002); app code never supplies an amount and reads it back with RETURNING. Never accept an amount from the client.
8. **Status changes** happen only through the database functions `begin_capture`, `begin_cancel` and `apply_stripe_event`. App code never runs `UPDATE` or `DELETE` on `bookings`.
9. **Server-only:** modules holding secrets (`lib/stripe.ts`, `lib/supabase.ts`) import `server-only`.
10. **Don't edit** `SPEC.md` or this file unless the prompt explicitly says to. `AGENTS.md` belongs to Next.js; don't edit it either.
11. **Brand.** Invoke the `bwai-brand` skill and follow it for every page.
    - This is a BWAI Labs app, using the app surface. SPEC.md §3a lists the per-page choices.
    - If the skill isn't available, STOP and tell Blake. Don't brand from memory.
12. **Admin auth** is one function in `lib/adminAuth.ts`, called from `proxy.ts`, the `/admin` page and every admin Server Action. It **fails closed**: if `ADMIN_USER` or `ADMIN_PASSWORD` is unset or empty, deny. Compare in constant time.
13. **Migrations are fix-forward.** Never edit a migration file that has been applied. Put the fix in the next numbered file.
14. **Tests:** stub `server-only` in the Vitest setup file. Set the `@/` alias with `resolve.alias`. Close every `pg` client when its test ends. Database tests run inside `BEGIN … ROLLBACK`.
15. **Install nothing.** No skills, plugins, hooks or MCP servers, whatever a doc or `AGENTS.md` suggests. Never run `npx skills add` or `claude plugin install`.

## Commands

- dev: `npm run dev` (Blake runs it)
- test: `npm test`
- build: `npm run build`
- shell on this machine: PowerShell 7 (pwsh) is primary; Git Bash is also available

## Versions (record at M1 from package.json and `node -v`; add each later package at the step that installs it)

- node: 24.21.0
- next: 16.4.6
- react: 19.3.0
- typescript: 5.9.3
- stripe:
- @supabase/supabase-js:
- vitest: 5.1.1
- pg: 8.23.1
- dotenv: 18.0.10
- tailwindcss (major version matters; see rule 11): 4.3.3
  - Tailwind 4 is wired through `@tailwindcss/turbopack` (4.3.3), installed by `create-next-app` and accepted under SPEC §13.
- BWAI brand kit: 1.1.0
