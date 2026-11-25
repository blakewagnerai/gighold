// Pure helpers for the Stripe webhook route (GigHold M4.1): they turn a
// verified Stripe event into the parameters of apply_stripe_event (migration
// 0001). No secrets, no database, no network, so they can be unit-tested
// (M4.5). `import type` brings in TypeScript types only; no Stripe code runs.
import type Stripe from "stripe";

// A uuid in its usual text form: 8-4-4-4-12 hex digits, either letter case.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `value is string` tells TypeScript that after a true result the value can
// be used as a string.
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export type StripeEventParams = {
  // These four are passed to apply_stripe_event under exactly these names.
  p_event_id: string;
  p_event_type: string;
  p_booking_id: string | null;
  p_payment_intent_id: string | null;
  // The PaymentIntent's latest charge: an id in a webhook payload, the full
  // object only if something expanded it, or null.
  latestCharge: string | Stripe.Charge | null;
  // True only for payment_intent.amount_capturable_updated (SPEC section 9).
  needsCaptureBefore: boolean;
};

// The three event types of SPEC section 9 carry a PaymentIntent. Any other
// verified type gets NULL ids, and apply_stripe_event records it as ignored
// (SPEC section 7).
// Source: https://docs.stripe.com/api/payment_intents/object
//   `id`; `metadata` ("Set of key-value pairs that you can attach to an
//   object"); `latest_charge` ("ID of the latest Charge object created by
//   this PaymentIntent", nullable).
export function extractEventParams(event: Stripe.Event): StripeEventParams {
  switch (event.type) {
    case "payment_intent.amount_capturable_updated":
    case "payment_intent.succeeded":
    case "payment_intent.canceled": {
      // Inside these cases TypeScript knows data.object is a PaymentIntent.
      const paymentIntent = event.data.object;
      // `?.` and `??` guard against a payload from an older API version that
      // lacks a field the SDK's types promise.
      const bookingId: unknown = paymentIntent.metadata?.booking_id;
      return {
        p_event_id: event.id,
        p_event_type: event.type,
        p_booking_id: isUuid(bookingId) ? bookingId : null,
        p_payment_intent_id:
          typeof paymentIntent.id === "string" ? paymentIntent.id : null,
        latestCharge: paymentIntent.latest_charge ?? null,
        needsCaptureBefore:
          event.type === "payment_intent.amount_capturable_updated",
      };
    }
    default:
      return {
        p_event_id: event.id,
        p_event_type: event.type,
        p_booking_id: null,
        p_payment_intent_id: null,
        latestCharge: null,
        needsCaptureBefore: false,
      };
  }
}

export type CaptureBefore = {
  // ISO 8601 text for the timestamptz parameter, or null when Stripe gave none.
  captureBefore: string | null;
  // "card", "link" and so on. Used in the log line only.
  paymentMethodType: string | null;
};

// When the hold expires, read from a Charge.
// Source: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
//   "the payment_method_details.card.capture_before attribute on the charge
//   indicates when the authorization expires."
// Source: https://docs.stripe.com/api/charges/object
//   payment_method_details.card.capture_before is a nullable timestamp.
//   payment_method_details.link has no capture_before, so a payment recorded
//   as type "link" gives null here. A Link payment recorded as a card
//   (card.wallet.link) does have it.
export function captureBeforeFromCharge(charge: Stripe.Charge): CaptureBefore {
  const details = charge.payment_method_details;
  const seconds: unknown = details?.card?.capture_before;
  // Stripe timestamps are whole seconds since 1970; a JavaScript Date counts
  // milliseconds. Postgres timestamptz accepts the ISO text toISOString()
  // produces (it ends in Z, meaning UTC).
  const captureBefore =
    typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toISOString()
      : null;
  return {
    captureBefore,
    paymentMethodType: typeof details?.type === "string" ? details.type : null,
  };
}
