import { expect, test } from "vitest";
import { withRollback } from "./db";

// Smoke test for M2.4: proves DATABASE_URL connects and withRollback works.
// D1-D7 come in the next step.
//
// to_regclass returns NULL when the object does not exist (it does not raise),
// much like OBJECT_ID('schema.table') in T-SQL. The ::text casts make pg
// return plain strings.
//
// The 15 s timeout (Vitest's default is 5 s) allows for a slow first
// connection to the remote pooler.
test("smoke: connects, and both tables from 0001_init.sql exist", async () => {
  await withRollback(async (client) => {
    const result = await client.query(
      `select to_regclass('public.bookings')::text      as bookings,
              to_regclass('public.stripe_events')::text as stripe_events`,
    );
    expect(result.rows[0].bookings).not.toBeNull();
    expect(result.rows[0].stripe_events).not.toBeNull();
  });
}, 15_000);
