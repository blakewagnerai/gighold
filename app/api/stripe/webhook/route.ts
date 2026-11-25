// The Stripe webhook (GigHold M4.1, SPEC sections 7 and 9).
// It verifies the signature, pulls five values out of the event and hands
// them to the database function apply_stripe_event, which does the deduping
// and every status change (CLAUDE.md hard rule 8). This file never writes to
// bookings itself.
//
// A route.ts file exporting POST handles POST requests to its folder's path;
// Next.js answers any other method with 405. Route Handlers are not cached
// by default, and methods other than GET are never cached.
// Source: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md

import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import {
  captureBeforeFromCharge,
  extractEventParams,
} from "@/lib/stripeEventParams";
import { getSupabase } from "@/lib/supabase";

// The three values apply_stripe_event can return (migration 0001).
const OUTCOMES = ["processed", "duplicate", "ignored"];

// The error type for the log: Stripe's own type (for example
// "StripeSignatureVerificationError"), or the error's name. Never the message.
function errorType(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) return err.type;
  if (err instanceof Error) return err.name;
  return "unknown";
}

// (g) The one log line per request. Every path below ends in finish().
// JSON.stringify keeps it on a single line. It holds ids, the event type,
// and an outcome or an error type: no customer data, no secrets, no error
// messages.
function finish(
  status: number,
  fields: Record<string, string | boolean | null>,
): Response {
  const line = `stripe webhook ${JSON.stringify({ status, ...fields })}`;
  if (status >= 500) {
    console.error(line);
  } else {
    console.log(line);
  }
  // The body is a fixed word. Nothing from the request is echoed back.
  return new Response(status === 200 ? "ok" : "error", { status });
}

export async function POST(request: Request): Promise<Response> {
  // (a) Fail closed. `!secret` is true for both unset and empty. The log
  // names the variable and never holds a value.
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return finish(500, {
      eventId: null,
      type: null,
      errorType: "STRIPE_WEBHOOK_SECRET_not_set",
    });
  }

  // (b) The raw body, as text, before anything parses it. The signature was
  // computed over these exact bytes, so a parsed and re-serialized body
  // would fail the check.
  // Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
  //   ("Webhooks": `const text = await request.text()`; no bodyParser config)
  // Source: https://docs.stripe.com/webhooks
  //   "Stripe requires the raw body of the request to perform signature
  //   verification."
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    return finish(400, { eventId: null, type: null, errorType: errorType(err) });
  }
  // Header names are case-insensitive; this reads Stripe-Signature.
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return finish(400, {
      eventId: null,
      type: null,
      errorType: "signature_header_missing",
    });
  }

  // getStripe() throws if STRIPE_SECRET_KEY is unset. That is our fault, not
  // the caller's, so it is a 500 and is kept apart from the signature check.
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    return finish(500, { eventId: null, type: null, errorType: errorType(err) });
  }

  // (c) Verify the signature. constructEvent(payload, header, secret) throws
  // a signature verification error on a mismatch and returns the parsed
  // event otherwise. No database call has happened yet.
  // Source: https://docs.stripe.com/webhooks ("You perform the verification
  //   by providing the event payload, the Stripe-Signature header, and the
  //   endpoint's secret.")
  // Signature checked against the installed SDK:
  //   node_modules/stripe/esm/Webhooks.d.ts (constructEvent)
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return finish(400, { eventId: null, type: null, errorType: errorType(err) });
  }

  // (d) Event to parameters: a pure function in lib/stripeEventParams.ts.
  const params = extractEventParams(event);

  // (e) capture_before, only for payment_intent.amount_capturable_updated.
  // The event carries the charge's id, not the charge, so it is fetched.
  let captureBefore: string | null = null;
  // Extra log fields, filled in only when Stripe gave no capture_before.
  let captureBeforeNote: Record<string, string | boolean | null> = {};
  if (params.needsCaptureBefore) {
    try {
      // Source: https://docs.stripe.com/api/charges/retrieve
      //   stripe.charges.retrieve('ch_...') returns the Charge.
      const charge =
        typeof params.latestCharge === "string"
          ? await stripe.charges.retrieve(params.latestCharge)
          : params.latestCharge;
      const found = charge ? captureBeforeFromCharge(charge) : null;
      captureBefore = found?.captureBefore ?? null;
      if (captureBefore === null) {
        // Not a failure: the booking is still authorized, with no expiry
        // date. A payment recorded as type "link" lands here.
        captureBeforeNote = {
          captureBeforeMissing: true,
          paymentMethodType: found?.paymentMethodType ?? null,
        };
      }
    } catch (err) {
      // The Stripe call itself failed. Nothing has been written, so Stripe's
      // retry starts clean.
      return finish(500, {
        eventId: params.p_event_id,
        type: params.p_event_type,
        errorType: errorType(err),
      });
    }
  }

  // (f) One database call. The keys are apply_stripe_event's parameter names,
  // exactly as in migration 0001. A null here arrives as SQL NULL.
  // Source: https://supabase.com/docs/reference/javascript/rpc
  //   `const { data, error } = await supabase.rpc('fn', { name: value })`
  // supabase-js reports a failure in `error` instead of throwing. The try
  // also covers getSupabase() throwing for an unset variable.
  let outcome: unknown;
  try {
    const { data, error } = await getSupabase().rpc("apply_stripe_event", {
      p_event_id: params.p_event_id,
      p_event_type: params.p_event_type,
      p_booking_id: params.p_booking_id,
      p_payment_intent_id: params.p_payment_intent_id,
      p_capture_before: captureBefore,
    });
    if (error) {
      // error.code is a Postgres or PostgREST code such as "42501". The
      // message is not logged: Postgres messages can quote row values.
      return finish(500, {
        eventId: params.p_event_id,
        type: params.p_event_type,
        errorType: `supabase_rpc:${error.code || "unknown"}`,
      });
    }
    outcome = data;
  } catch (err) {
    return finish(500, {
      eventId: params.p_event_id,
      type: params.p_event_type,
      errorType: errorType(err),
    });
  }

  // Anything but the three known words means the call did not do what we
  // expect. 500 makes Stripe retry and puts the problem in the log.
  if (typeof outcome !== "string" || !OUTCOMES.includes(outcome)) {
    return finish(500, {
      eventId: params.p_event_id,
      type: params.p_event_type,
      errorType: "unexpected_outcome",
    });
  }

  // 'processed', 'duplicate' and 'ignored' are all a success to Stripe.
  return finish(200, {
    eventId: params.p_event_id,
    type: params.p_event_type,
    outcome,
    ...captureBeforeNote,
  });
}
