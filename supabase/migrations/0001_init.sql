-- 0001_init.sql  (GigHold M2.1)
--
-- Creates the whole database side of GigHold, per SPEC.md sections 5-8:
--   1. tables public.bookings and public.stripe_events
--   2. the bookings_guard trigger (the state-machine referee)
--   3. functions begin_capture, begin_cancel and apply_stripe_event
--   4. row level security on both tables, with no policies
--   5. revokes first, then only the grants service_role needs
--
-- FROZEN ONCE APPLIED (CLAUDE.md rule 13). Never edit this file after it has
-- run against the database. A fix goes in the next numbered file.
--
-- This file contains no transaction statements. For a dry run in the Supabase
-- SQL Editor, Blake wraps it in an explicit transaction that he rolls back.
--
-- Written to run on Postgres 15 and later. The "current" docs cited below
-- are for Postgres 19; nothing here uses a feature newer than 15.

-- ===========================================================================
-- 1. Tables (SPEC section 6)
-- ===========================================================================

-- Docs: https://www.postgresql.org/docs/current/functions-uuid.html
--   gen_random_uuid() is built in and returns a version 4 (random) uuid.
-- Not in the database on purpose (SPEC section 6: enforced in the app):
--   customer_name length 1-100, and event_date being today or later.
create table public.bookings (
  id                uuid        primary key default gen_random_uuid(),
  customer_name     text        not null,
  customer_email    text        not null,
  event_date        date        not null,
  amount_cents      integer     not null check (amount_cents > 0),
  currency          text        not null default 'usd',
  status            text        not null default 'pending_payment'
                                check (status in (
                                  'pending_payment',
                                  'authorized',
                                  'capture_pending',
                                  'captured',
                                  'cancel_pending',
                                  'canceled'
                                )),
  payment_intent_id text        unique,
  capture_before    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- booking_id has NO foreign key, deliberately (SPEC section 6). An event can
-- name a booking that does not exist (a fixture event, or another
-- environment), and the webhook must never fail because of that.
-- outcome is null only inside apply_stripe_event, between the insert and the
-- moment the outcome is set. A CHECK passes when the value is null.
create table public.stripe_events (
  id                text        primary key,
  type              text        not null,
  booking_id        uuid,
  outcome           text        check (outcome in ('processed', 'ignored')),
  delivery_count    integer     not null default 1,
  first_received_at timestamptz not null default now(),
  last_received_at  timestamptz not null default now()
);

-- ===========================================================================
-- 2. Guard trigger (SPEC sections 5 and 6)
-- ===========================================================================

-- Docs: https://www.postgresql.org/docs/current/plpgsql-trigger.html
--   A trigger function takes no arguments and returns type trigger. OLD and
--   NEW are the row before and after. A BEFORE row trigger returns NEW, and
--   changes made to NEW are what gets stored.
-- Docs: https://www.postgresql.org/docs/current/sql-createfunction.html
--   SET search_path applies on entry and is restored on exit.
-- Docs: https://www.postgresql.org/docs/current/runtime-config-client.html
--   pg_catalog is always searched, even with an empty search_path.
-- Docs: https://www.postgresql.org/docs/current/plpgsql-errors-and-messages.html
--   RAISE EXCEPTION aborts the statement; each % takes the next argument.
-- amount_cents and status are NOT NULL, so <> is a safe comparison here.
create function public.bookings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.amount_cents <> old.amount_cents then
    raise exception 'bookings.amount_cents is immutable (booking %)', old.id;
  end if;

  -- Exactly the eight transitions in SPEC section 5. An update that leaves
  -- status unchanged is not a status change, so it passes.
  if new.status <> old.status then
    if not (
         (old.status = 'pending_payment' and new.status in ('authorized', 'canceled'))
      or (old.status = 'authorized'      and new.status in ('capture_pending', 'cancel_pending', 'canceled'))
      or (old.status = 'capture_pending' and new.status in ('captured', 'canceled'))
      or (old.status = 'cancel_pending'  and new.status = 'canceled')
    ) then
      raise exception 'illegal booking status transition: % -> % (booking %)',
        old.status, new.status, old.id;
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Docs: https://www.postgresql.org/docs/current/sql-createtrigger.html
--   FOR EACH STATEMENT is the default, so FOR EACH ROW must be written.
create trigger bookings_guard
  before update on public.bookings
  for each row
  execute function public.bookings_guard();

-- ===========================================================================
-- 3. Functions (SPEC section 7)
-- ===========================================================================

-- Docs: https://www.postgresql.org/docs/current/sql-createfunction.html
--   SECURITY DEFINER runs with the privileges of the function's owner. The
--   docs say to set search_path on such functions, and to revoke the default
--   EXECUTE grant to PUBLIC (done in part 5).
-- Docs: https://www.postgresql.org/docs/current/plpgsql-statements.html
--   UPDATE ... RETURNING ... INTO sets the variable to null when no row was
--   updated. That is the compare-and-set: the WHERE clause is the compare.
create function public.begin_capture(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_intent_id text;
begin
  update public.bookings
     set status = 'capture_pending'
   where id = p_booking_id
     and status = 'authorized'
  returning payment_intent_id into v_payment_intent_id;

  return v_payment_intent_id;
end;
$$;

-- Same pattern and same docs as begin_capture: authorized -> cancel_pending.
create function public.begin_cancel(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_intent_id text;
begin
  update public.bookings
     set status = 'cancel_pending'
   where id = p_booking_id
     and status = 'authorized'
  returning payment_intent_id into v_payment_intent_id;

  return v_payment_intent_id;
end;
$$;

-- Returns 'duplicate', 'processed' or 'ignored'.
-- There is no exception handler, on purpose (SPEC section 7 step 4): any
-- error rolls back the whole call, including the event insert, so the route
-- returns 500 and Stripe retries.
-- Docs: https://www.postgresql.org/docs/current/sql-createfunction.html
--   SECURITY DEFINER and SET search_path, as above.
create function public.apply_stripe_event(
  p_event_id          text,
  p_event_type        text,
  p_booking_id        uuid,
  p_payment_intent_id text,
  p_capture_before    timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery_count integer;
  v_rows           bigint := 0;
  v_outcome        text;
begin
  -- Step 1: record the delivery. A second delivery of the same event id
  -- waits for the first to commit, then takes the DO UPDATE branch.
  -- Docs: https://www.postgresql.org/docs/current/sql-insert.html
  --   ON CONFLICT (column) DO UPDATE; the existing row is reached through
  --   the table alias; RETURNING gives the row as stored.
  insert into public.stripe_events as e (id, type, booking_id)
  values (p_event_id, p_event_type, p_booking_id)
  on conflict (id) do update
    set delivery_count   = e.delivery_count + 1,
        last_received_at = pg_catalog.now()
  returning e.delivery_count into v_delivery_count;

  if v_delivery_count > 1 then
    return 'duplicate';
  end if;

  -- Step 2: the event mapping. Each UPDATE is guarded by its allowed
  -- from-states, so an out-of-order event touches 0 rows.
  -- Docs: https://www.postgresql.org/docs/current/plpgsql-statements.html
  --   GET DIAGNOSTICS ... ROW_COUNT is the row count of the last statement.
  if p_booking_id is not null then
    if p_event_type = 'payment_intent.amount_capturable_updated' then
      -- The "is not null" guard is Blake's decision at M2.1, beyond the
      -- SPEC table: a booking must never be authorized without an id.
      update public.bookings
         set status            = 'authorized',
             payment_intent_id = p_payment_intent_id,
             capture_before    = p_capture_before
       where id = p_booking_id
         and status = 'pending_payment'
         and p_payment_intent_id is not null;
      get diagnostics v_rows = row_count;

    elsif p_event_type = 'payment_intent.succeeded' then
      update public.bookings
         set status = 'captured'
       where id = p_booking_id
         and status = 'capture_pending'
         and payment_intent_id = p_payment_intent_id;
      get diagnostics v_rows = row_count;

    elsif p_event_type = 'payment_intent.canceled' then
      update public.bookings
         set status = 'canceled'
       where id = p_booking_id
         and status in ('pending_payment', 'authorized', 'capture_pending', 'cancel_pending')
         and (payment_intent_id is null or payment_intent_id = p_payment_intent_id);
      get diagnostics v_rows = row_count;
    end if;
  end if;

  -- Step 3: 0 rows, an unmapped type, or a null booking id all mean ignored.
  if v_rows > 0 then
    v_outcome := 'processed';
  else
    v_outcome := 'ignored';
  end if;

  update public.stripe_events
     set outcome = v_outcome
   where id = p_event_id;

  return v_outcome;
end;
$$;

-- ===========================================================================
-- 4. Row level security (SPEC section 8)
-- ===========================================================================

-- Docs: https://supabase.com/docs/guides/database/postgres/row-level-security
--   With RLS on and no policies, a role that does not bypass RLS sees no
--   rows. service_role has the bypassrls attribute. No policies are created.
alter table public.bookings enable row level security;
alter table public.stripe_events enable row level security;

-- ===========================================================================
-- 5. Revoke first, then grant (SPEC section 8, CLAUDE.md rule 3)
-- ===========================================================================

-- Docs: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
--   New tables in public need explicit grants before the Data API can reach
--   them. Revoking first gives the same result whichever default the
--   project started with.
-- Docs: https://www.postgresql.org/docs/current/sql-revoke.html
--   REVOKE ALL on a table also removes any column privileges on it.
revoke all on table public.bookings from anon, authenticated, service_role;
revoke all on table public.stripe_events from anon, authenticated, service_role;

-- Docs: https://www.postgresql.org/docs/current/sql-createfunction.html
--   "by default, execute privilege is granted to PUBLIC for newly created
--   functions", so PUBLIC is revoked as well as the three Supabase roles.
-- Docs: https://www.postgresql.org/docs/current/sql-revoke.html
--   A function is named together with its argument types.
revoke execute on function public.begin_capture(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.begin_cancel(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.apply_stripe_event(text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;

-- Blake's decision at M2.1, beyond SPEC section 8: the trigger function is
-- a new function in public too (CLAUDE.md rule 3), so it is revoked and
-- gets no grant. The trigger still fires: every update of bookings runs
-- inside the functions above, as their owner.
revoke execute on function public.bookings_guard()
  from public, anon, authenticated, service_role;

-- Docs: https://www.postgresql.org/docs/current/sql-grant.html
grant select on table public.bookings to service_role;

-- Blake's decision at M2.1, beyond SPEC section 8: INSERT is granted on
-- four columns only, not on the whole table. An insert that names any other
-- column (status, payment_intent_id, id, currency ...) is refused, so every
-- new booking starts as 'pending_payment' from the column default.
-- Docs: https://www.postgresql.org/docs/current/sql-grant.html
--   GRANT INSERT ( column_name [, ...] ) ON [ TABLE ] table_name.
-- Docs: https://www.postgresql.org/docs/current/ddl-priv.html
--   With a column-level INSERT grant, "only those columns may be assigned
--   to in the INSERT command (other columns will therefore receive default
--   values)".
grant insert (customer_name, customer_email, event_date, amount_cents)
  on table public.bookings to service_role;

grant select on table public.stripe_events to service_role;

-- Docs: https://www.postgresql.org/docs/current/sql-grant.html
grant execute on function public.begin_capture(uuid) to service_role;
grant execute on function public.begin_cancel(uuid) to service_role;
grant execute on function public.apply_stripe_event(text, text, uuid, text, timestamptz)
  to service_role;

-- No UPDATE or DELETE is granted to anyone. The only way to change a
-- booking's status is through the three functions above.
