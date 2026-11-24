import { expect, test } from "vitest";
import type { Client } from "pg";
import { withRollback } from "./db";

// Database tests D1-D7 (SPEC.md section 11), GigHold M2.5.
//
// Every test runs inside withRollback (tests/db.ts): BEGIN, the test body,
// then always ROLLBACK and close the client. Nothing here persists.
//
// The connection is the table owner, so it can do things the app's role
// cannot. D1 and D2 use that on purpose: they run a direct UPDATE to prove
// the trigger stops even the owner. D6 and D7 step down to the app-facing
// roles with SET LOCAL ROLE to prove the grants.
//
// Postgres vs T-SQL, used throughout this file:
//   - Errors carry a five-character SQLSTATE code, not an error number.
//     P0001 = raise_exception (a plain RAISE EXCEPTION in PL/pgSQL, like
//     THROW 50000). 42501 = insufficient_privilege (like Msg 229).
//     Source: https://www.postgresql.org/docs/current/errcodes-appendix.html
//   - After any error, the transaction is aborted: every later statement
//     fails with 25P02 until ROLLBACK or ROLLBACK TO SAVEPOINT. T-SQL (with
//     XACT_ABORT off) would let the transaction carry on.
//   - Parameters are positional ($1, $2), not named (@id).
//   - `select some_function(...)` calls a function; there is no EXEC.

const TIMEOUT_MS = 15_000; // a slow first connection to the remote pooler
const DEPOSIT_CENTS = 15000;
const CAPTURE_BEFORE = "2030-01-08T00:00:00Z";

/**
 * Inserts one booking and returns its id. It names only the four columns the
 * migration grants INSERT on, so status comes from the column default
 * ('pending_payment'). RETURNING is the Postgres form of T-SQL's OUTPUT.
 */
async function insertBooking(client: Client): Promise<string> {
  // Source: https://node-postgres.com/apis/client#clientquery (text, values)
  const result = await client.query<{ id: string }>(
    `insert into public.bookings
       (customer_name, customer_email, event_date, amount_cents)
     values ($1, $2, $3, $4)
     returning id`,
    ["Test Customer", "test.customer@example.com", "2030-01-01", DEPOSIT_CENTS],
  );
  return result.rows[0].id;
}

/** Calls public.apply_stripe_event and returns its outcome text. */
async function applyStripeEvent(
  client: Client,
  eventId: string,
  eventType: string,
  bookingId: string,
  paymentIntentId: string,
  captureBefore: string | null,
): Promise<string> {
  const result = await client.query<{ outcome: string }>(
    `select public.apply_stripe_event($1, $2, $3::uuid, $4, $5::timestamptz) as outcome`,
    [eventId, eventType, bookingId, paymentIntentId, captureBefore],
  );
  return result.rows[0].outcome;
}

/**
 * Moves a booking from 'pending_payment' to 'authorized' the legal way: the
 * same event the webhook will send. Asserts the outcome so that a broken
 * setup fails here, not later in a confusing place.
 */
async function authorize(
  client: Client,
  bookingId: string,
  eventId: string,
  paymentIntentId: string,
): Promise<void> {
  const outcome = await applyStripeEvent(
    client,
    eventId,
    "payment_intent.amount_capturable_updated",
    bookingId,
    paymentIntentId,
    CAPTURE_BEFORE,
  );
  expect(outcome).toBe("processed");
}

async function readBooking(
  client: Client,
  bookingId: string,
): Promise<{ status: string; amount_cents: number }> {
  const result = await client.query<{ status: string; amount_cents: number }>(
    `select status, amount_cents from public.bookings where id = $1`,
    [bookingId],
  );
  return result.rows[0];
}

/** The role that permission checks currently run as. */
async function currentRole(client: Client): Promise<string> {
  const result = await client.query<{ role: string }>(
    `select current_user::text as role`,
  );
  return result.rows[0].role;
}

/**
 * Reads the SQLSTATE from a thrown value without using `any`.
 * The node-postgres client page does not list the error's fields; `code` is
 * confirmed from the installed types: DatabaseError.code in
 * node_modules/pg-protocol/dist/messages.d.ts.
 * Source: https://node-postgres.com/apis/client (errors go to the query promise)
 */
function sqlState(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Awaits a query that must fail, then checks the SQLSTATE and the message.
 * If the query succeeds, `caught` stays undefined and the first check fails.
 */
async function expectPgError(
  query: Promise<unknown>,
  code: string,
  message: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await query;
  } catch (error) {
    caught = error;
  }
  expect(caught, "the statement should have failed").toBeInstanceOf(Error);
  expect(sqlState(caught)).toBe(code);
  expect((caught as Error).message).toMatch(message);
}

// ---------------------------------------------------------------------------
// D1, D2: the trigger
// ---------------------------------------------------------------------------

// Source: https://www.postgresql.org/docs/current/sql-savepoint.html
//   A savepoint lets the commands after it be rolled back, "restoring the
//   transaction state to what it was at the time of the savepoint".
// Source: https://www.postgresql.org/docs/current/sql-rollback-to.html
// Without the savepoint, the re-read after the expected error would fail
// with 25P02 (in_failed_sql_transaction).
test(
  "D1: the trigger rejects pending_payment -> captured",
  async () => {
    await withRollback(async (client) => {
      const bookingId = await insertBooking(client);
      await client.query("SAVEPOINT before_illegal_update");

      await expectPgError(
        client.query(
          `update public.bookings set status = 'captured' where id = $1`,
          [bookingId],
        ),
        "P0001",
        /illegal booking status transition: pending_payment -> captured/,
      );

      await client.query("ROLLBACK TO SAVEPOINT before_illegal_update");
      const booking = await readBooking(client, bookingId);
      expect(booking.status).toBe("pending_payment");
    });
  },
  TIMEOUT_MS,
);

test(
  "D2: the trigger rejects a change to amount_cents",
  async () => {
    await withRollback(async (client) => {
      const bookingId = await insertBooking(client);
      await client.query("SAVEPOINT before_amount_update");

      await expectPgError(
        client.query(
          `update public.bookings set amount_cents = amount_cents + 1 where id = $1`,
          [bookingId],
        ),
        "P0001",
        /bookings\.amount_cents is immutable/,
      );

      await client.query("ROLLBACK TO SAVEPOINT before_amount_update");
      const booking = await readBooking(client, bookingId);
      expect(booking.amount_cents).toBe(DEPOSIT_CENTS);
    });
  },
  TIMEOUT_MS,
);

// ---------------------------------------------------------------------------
// D3, D4, D5: the functions
// ---------------------------------------------------------------------------

test(
  "D3: begin_capture returns the PaymentIntent id once, then NULL",
  async () => {
    await withRollback(async (client) => {
      const bookingId = await insertBooking(client);
      await authorize(client, bookingId, "evt_test_d3_auth", "pi_test_d3");

      const first = await client.query<{ pi: string | null }>(
        `select public.begin_capture($1::uuid) as pi`,
        [bookingId],
      );
      const second = await client.query<{ pi: string | null }>(
        `select public.begin_capture($1::uuid) as pi`,
        [bookingId],
      );

      expect(first.rows[0].pi).toBe("pi_test_d3");
      expect(second.rows[0].pi).toBeNull();
      const booking = await readBooking(client, bookingId);
      expect(booking.status).toBe("capture_pending");
    });
  },
  TIMEOUT_MS,
);

// "The status changed once" is shown by the status after each call plus the
// 'duplicate' return. updated_at cannot show it: inside one transaction
// Postgres now() is frozen at the transaction's start (GETDATE() is not).
test(
  "D4: the same event id twice is processed, then duplicate",
  async () => {
    await withRollback(async (client) => {
      const bookingId = await insertBooking(client);
      const deliver = () =>
        applyStripeEvent(
          client,
          "evt_test_d4",
          "payment_intent.amount_capturable_updated",
          bookingId,
          "pi_test_d4",
          CAPTURE_BEFORE,
        );

      expect(await deliver()).toBe("processed");
      expect((await readBooking(client, bookingId)).status).toBe("authorized");

      expect(await deliver()).toBe("duplicate");
      expect((await readBooking(client, bookingId)).status).toBe("authorized");

      const event = await client.query<{
        delivery_count: number;
        outcome: string | null;
      }>(
        `select delivery_count, outcome from public.stripe_events where id = $1`,
        ["evt_test_d4"],
      );
      expect(event.rows[0].delivery_count).toBe(2);
      expect(event.rows[0].outcome).toBe("processed");
    });
  },
  TIMEOUT_MS,
);

test(
  "D5: payment_intent.succeeded while authorized is ignored",
  async () => {
    await withRollback(async (client) => {
      const bookingId = await insertBooking(client);
      await authorize(client, bookingId, "evt_test_d5_auth", "pi_test_d5");

      const outcome = await applyStripeEvent(
        client,
        "evt_test_d5",
        "payment_intent.succeeded",
        bookingId,
        "pi_test_d5",
        null,
      );

      expect(outcome).toBe("ignored");
      const booking = await readBooking(client, bookingId);
      expect(booking.status).toBe("authorized");
      const event = await client.query<{ outcome: string | null }>(
        `select outcome from public.stripe_events where id = $1`,
        ["evt_test_d5"],
      );
      expect(event.rows[0].outcome).toBe("ignored");
    });
  },
  TIMEOUT_MS,
);

// ---------------------------------------------------------------------------
// D6, D7: the grants
// ---------------------------------------------------------------------------

// Source: https://www.postgresql.org/docs/current/sql-set-role.html
//   "SET [ SESSION | LOCAL ] ROLE role_name". After it, "permissions
//   checking for SQL commands is carried out as though the named role were
//   the one that had logged in originally". The session user "must have the
//   SET option for the specified role_name". LOCAL lasts until the
//   transaction ends, so withRollback's ROLLBACK undoes it.
// T-SQL: the nearest thing is EXECUTE AS USER = '...' followed by REVERT.
//
// A refused SET ROLE also raises 42501. So SET LOCAL ROLE is awaited on its
// own, outside expectPgError, and current_user is checked before the real
// statement. If the connection's role cannot switch, the test fails on that
// line. That is a SPEC section 15 "from memory" item: do not work around it,
// tell Blake.
test(
  "D6: role anon cannot SELECT from bookings",
  async () => {
    await withRollback(async (client) => {
      await insertBooking(client);
      await client.query("SET LOCAL ROLE anon");
      expect(await currentRole(client)).toBe("anon");

      await expectPgError(
        client.query(`select id from public.bookings`),
        "42501",
        /permission denied for table bookings/,
      );
    });
  },
  TIMEOUT_MS,
);

// service_role has SELECT on bookings, so the WHERE clause is allowed and
// each refusal comes from the missing UPDATE or DELETE grant.
// The savepoint is taken AFTER SET LOCAL ROLE, so rolling back to it keeps
// the role; the second currentRole check proves that.
test(
  "D7: role service_role cannot UPDATE or DELETE rows in bookings",
  async () => {
    await withRollback(async (client) => {
      const bookingId = await insertBooking(client);
      await client.query("SET LOCAL ROLE service_role");
      expect(await currentRole(client)).toBe("service_role");
      await client.query("SAVEPOINT before_denied_update");

      await expectPgError(
        client.query(
          `update public.bookings set status = 'canceled' where id = $1`,
          [bookingId],
        ),
        "42501",
        /permission denied for table bookings/,
      );

      await client.query("ROLLBACK TO SAVEPOINT before_denied_update");
      expect(await currentRole(client)).toBe("service_role");

      await expectPgError(
        client.query(`delete from public.bookings where id = $1`, [bookingId]),
        "42501",
        /permission denied for table bookings/,
      );
    });
  },
  TIMEOUT_MS,
);
