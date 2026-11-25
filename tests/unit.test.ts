// Unit tests U1, U2, U3 (GigHold M4.5, SPEC section 11).
// No database and no network. Nothing here reads .env.local: every
// environment variable the webhook route reads is replaced with a dummy
// before each U3 test and restored after it.

import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";
import {
  BOOKING_STATUSES,
  canTransition,
  idempotencyKey,
} from "@/lib/bookingStatus";

// Stand-ins for the database client. vi.mock (below) is moved to the top of
// the file before the imports run, so anything its factory uses must be
// created with vi.hoisted, which is moved up with it.
// Source: https://vitest.dev/api/vi.html#vi-hoisted
const mocks = vi.hoisted(() => {
  const rpc = vi.fn();
  // The route calls getSupabase().rpc(...), so the fake client has only rpc.
  const getSupabase = vi.fn(() => ({ rpc }));
  return { rpc, getSupabase };
});

// Replace lib/supabase with the stand-in. "If the factory function is
// defined, all imports will return its result", so the real module (and
// createClient) never loads, and a database call would be recorded here
// instead of being made. "You can use configured Vite aliases inside a path."
// Source: https://vitest.dev/api/vi.html#vi-mock
vi.mock("@/lib/supabase", () => ({ getSupabase: mocks.getSupabase }));

// Dummy values only. None of these is a real key or a real project.
const DUMMY_WEBHOOK_SECRET = "whsec_dummy_for_unit_test";
const DUMMY_STRIPE_KEY = "sk_test_dummy_for_unit_test";

describe("U1: canTransition", () => {
  test("is true for exactly the eight SPEC section 5 transitions, false for the other 28", () => {
    // Written out here from SPEC section 5, not read from the module, so the
    // test and the code cannot agree by sharing one mistake.
    const allowed = new Set([
      "pending_payment>authorized",
      "pending_payment>canceled",
      "authorized>capture_pending",
      "authorized>cancel_pending",
      "authorized>canceled",
      "capture_pending>captured",
      "capture_pending>canceled",
      "cancel_pending>canceled",
    ]);
    expect(allowed.size).toBe(8);

    let pairs = 0;
    let trueCount = 0;
    for (const from of BOOKING_STATUSES) {
      for (const to of BOOKING_STATUSES) {
        pairs += 1;
        const result = canTransition(from, to);
        if (result) trueCount += 1;
        // The second argument is the message Vitest shows if this pair fails.
        expect(result, `${from} -> ${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
    // Six statuses give 36 pairs. Counting them means a shortened status
    // list cannot pass quietly.
    expect(pairs).toBe(36);
    expect(trueCount).toBe(8);
    expect(pairs - trueCount).toBe(28);
  });
});

describe("U2: idempotencyKey", () => {
  test("is deterministic, and the capture key differs from the cancel key", () => {
    const bookingId = "11111111-2222-4333-8444-555555555555";

    // Same inputs, same key.
    expect(idempotencyKey("capture", bookingId)).toBe(
      idempotencyKey("capture", bookingId),
    );
    expect(idempotencyKey("cancel", bookingId)).toBe(
      idempotencyKey("cancel", bookingId),
    );

    // The exact format of SPEC section 9.
    expect(idempotencyKey("capture", bookingId)).toBe(`capture:${bookingId}`);
    expect(idempotencyKey("cancel", bookingId)).toBe(`cancel:${bookingId}`);

    // One booking, two actions, two different keys.
    expect(idempotencyKey("capture", bookingId)).not.toBe(
      idempotencyKey("cancel", bookingId),
    );
  });
});

describe("U3: webhook route and the Stripe-Signature header", () => {
  const body = JSON.stringify({
    id: "evt_unit_test",
    object: "event",
    // Not one of the three handled types, so the route makes no Stripe API
    // call for it (lib/stripeEventParams.ts, the default branch).
    type: "customer.created",
    data: { object: {} },
  });

  function webhookRequest(signature: string | null): Request {
    const headers = new Headers({ "content-type": "application/json" });
    if (signature !== null) headers.set("stripe-signature", signature);
    return new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers,
      body,
    });
  }

  beforeEach(() => {
    // vi.stubEnv changes process.env for the test; vi.unstubAllEnvs puts the
    // earlier values back.
    // Source: https://vitest.dev/api/vi.html#vi-stubenv
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", DUMMY_WEBHOOK_SECRET);
    vi.stubEnv("STRIPE_SECRET_KEY", DUMMY_STRIPE_KEY);
    vi.stubEnv("SUPABASE_URL", "https://example.invalid");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_dummy_for_unit_test");

    // Forget calls from the previous test.
    mocks.rpc.mockReset();
    mocks.getSupabase.mockClear();

    // The route logs one line per request; keep it out of the test output.
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("an invalid signature gets 400 and makes no database call", async () => {
    // Well-formed (a timestamp and a 64-hex-digit v1 value) but wrong.
    const now = Math.floor(Date.now() / 1000);
    const response = await POST(webhookRequest(`t=${now},v1=${"0".repeat(64)}`));

    expect(response.status).toBe(400);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  test("a missing signature gets 400 and makes no database call", async () => {
    const response = await POST(webhookRequest(null));

    expect(response.status).toBe(400);
    expect(mocks.getSupabase).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  // Control for the two tests above. They pass if the route never reaches the
  // database, but they would also pass if the stand-in were not wired in at
  // all. This one sends a correctly signed body and expects the stand-in to
  // record the call, which proves a database call would be detected.
  test("control: a valid signature reaches the mocked database once", async () => {
    mocks.rpc.mockResolvedValue({ data: "ignored", error: null });

    // generateTestHeaderString computes the header locally: "Useful for
    // signing payloads in unit tests." No network.
    // Source: node_modules/stripe/esm/Webhooks.d.ts (generateTestHeaderString)
    const signature = new Stripe(DUMMY_STRIPE_KEY).webhooks.generateTestHeaderString({
      payload: body,
      secret: DUMMY_WEBHOOK_SECRET,
    });
    const response = await POST(webhookRequest(signature));

    expect(response.status).toBe(200);
    expect(mocks.getSupabase).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("apply_stripe_event", {
      p_event_id: "evt_unit_test",
      p_event_type: "customer.created",
      p_booking_id: null,
      p_payment_intent_id: null,
      p_capture_before: null,
    });
  });
});
