-- 0002_amount_default.sql  (GigHold M3.0b)
-- What: gives bookings.amount_cents a default of 15000 (the $150.00 deposit,
-- in cents) and stops service_role from naming that column in an INSERT.
-- Why: Blake's decision that the deposit lives only in the database. App code
-- inserts without an amount and reads it back with RETURNING.

-- Docs: https://www.postgresql.org/docs/17/sql-altertable.html
--   ALTER [ COLUMN ] column_name SET DEFAULT expression. "The new default
--   value will only apply in subsequent INSERT or UPDATE commands; it does
--   not cause rows already in the table to change."
alter table public.bookings
  alter column amount_cents set default 15000;

-- Docs: https://www.postgresql.org/docs/17/sql-revoke.html
--   REVOKE { INSERT ... } ( column_name [, ...] ) ON [ TABLE ] table_name.
--   A column-level revoke has no effect when the role holds the privilege
--   on the whole table. 0001 granted INSERT on four named columns only
--   (no table-level INSERT), so this removes the amount_cents grant.
-- Docs: https://www.postgresql.org/docs/17/sql-grant.html
--   "the table-level grant is unaffected by a column-level operation".
revoke insert (amount_cents) on table public.bookings from service_role;
