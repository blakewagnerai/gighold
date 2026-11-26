"use server";
// The two admin Server Actions (GigHold M5.3, SPEC.md section 9 "Admin
// actions" and section 10 layers 1 and 2). Every export of a "use server"
// file is a Server Action; the helpers below are not exported, so they are
// ordinary server functions with no endpoint of their own.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md
//
// An action is its own entry point. It runs as a POST identified by an action
// ID, and "the route is reachable to anyone who can send the same POST", so
// each action checks the admin credentials itself and never relies on
// proxy.ts or the page having done it.
// Source: node_modules/next/dist/docs/01-app/02-guides/server-actions.md ("Security")
//         node_modules/next/dist/docs/01-app/02-guides/data-security.md
//           ("Authentication and authorization": "Always re-verify inside the action")

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Stripe from "stripe";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { idempotencyKey } from "@/lib/bookingStatus";
import { getStripe } from "@/lib/stripe";
import { isUuid } from "@/lib/stripeEventParams";
import { getSupabase } from "@/lib/supabase";

// The only values ever put in /admin?notice=. app/admin/page.tsx maps each
// one to a fixed message.
type Notice =
  | "capture-started"
  | "cancel-started"
  | "in-progress"
  | "failed"
  | "db-error";

type AdminAction = "capture" | "cancel";

// Per action: the database function that makes the decision, the notice for
// "sent to Stripe", and the label used in the server log.
const ACTIONS: Record<
  AdminAction,
  { rpc: "begin_capture" | "begin_cancel"; started: Notice; label: string }
> = {
  capture: {
    rpc: "begin_capture",
    started: "capture-started",
    label: "approveBooking",
  },
  cancel: {
    rpc: "begin_cancel",
    started: "cancel-started",
    label: "declineBooking",
  },
};

// For the server log: Stripe's own error type and code (for example
// "StripeInvalidRequestError" and "payment_intent_unexpected_state"), or the
// error's class name. Never the message, which can carry data.
function describeError(err: unknown): {
  errorType: string;
  errorCode: string | null;
} {
  if (err instanceof Stripe.errors.StripeError) {
    return { errorType: err.type, errorCode: err.code ?? null };
  }
  if (err instanceof Error) {
    return { errorType: err.constructor.name, errorCode: null };
  }
  return { errorType: typeof err, errorCode: null };
}

// Everything after the auth check, shared by both actions. Returns the notice
// code; the caller redirects. It never reads the booking's status and never
// runs UPDATE or DELETE (CLAUDE.md hard rule 8): begin_capture / begin_cancel
// decide, and the webhook sets captured / canceled later.
async function beginAndSend(
  action: AdminAction,
  formData: FormData,
): Promise<Notice> {
  const { rpc, started, label } = ACTIONS[action];

  // The hidden field is client input, so it is checked like any other. Not a
  // uuid: no database call at all.
  const bookingId = formData.get("bookingId");
  if (!isUuid(bookingId)) {
    return "in-progress";
  }

  // Configuration is checked before the database is touched, and outside the
  // try block, so a misconfigured server fails loudly and names the variable
  // instead of moving a booking to capture_pending and then being unable to
  // call Stripe (same pattern as createBooking in app/actions.ts).
  const supabase = getSupabase();
  const stripe = getStripe();

  // Set on the line before the Stripe call, so the catch block can tell a
  // database failure from a Stripe failure.
  let stripeStarted = false;

  try {
    // THE DECISION. A compare-and-set in the database: the row moves from
    // authorized to capture_pending (or cancel_pending) only if it is still
    // authorized, and only then is its PaymentIntent id returned. A second
    // click, a second tab or a booking in any other status gets NULL.
    // Source: https://supabase.com/docs/reference/javascript/rpc
    //   `const { data, error } = await supabase.rpc('fn', { name: value })`
    // supabase-js reports a failure in `error` instead of throwing.
    const { data, error } = await supabase.rpc(rpc, {
      p_booking_id: bookingId,
    });

    if (error) {
      // error.code is a Postgres or PostgREST code such as "42501". The
      // message is not logged: Postgres messages can quote row values.
      console.error(`${label} failed`, {
        bookingId,
        errorType: `supabase_rpc:${error.code || "unknown"}`,
        errorCode: null,
      });
      return "db-error";
    }

    // NULL back: someone else already started, or the booking is not waiting
    // on a decision. No Stripe call.
    const paymentIntentId: unknown = data;
    if (typeof paymentIntentId !== "string" || paymentIntentId === "") {
      return "in-progress";
    }

    stripeStarted = true;
    // The idempotency key is "capture:<booking id>" or "cancel:<booking id>"
    // (SPEC.md section 9), passed as a request option, the third argument.
    // The empty object is the params argument: no amount is ever sent, so
    // Stripe captures the full authorized amount (hard rule 7).
    // Source: https://docs.stripe.com/api/idempotent_requests
    //   "Retries with the same key return the saved response, including 500
    //   errors." Keys can be removed once they are at least 24 hours old.
    const options = { idempotencyKey: idempotencyKey(action, bookingId) };
    if (action === "capture") {
      // Source: https://docs.stripe.com/api/payment_intents/capture
      //   "Capture the funds of an existing uncaptured PaymentIntent when its
      //   status is requires_capture." "Returns an error if the PaymentIntent
      //   isn't capturable".
      await stripe.paymentIntents.capture(paymentIntentId, {}, options);
    } else {
      // Source: https://docs.stripe.com/api/payment_intents/cancel
      //   "You can directly cancel the PaymentIntent for a Checkout Session
      //   only when the PaymentIntent has a status of requires_capture."
      //   "Returns an error if the PaymentIntent is already canceled or isn't
      //   in a cancelable state."
      await stripe.paymentIntents.cancel(paymentIntentId, {}, options);
    }
    return started;
  } catch (err) {
    // Server log: the booking id plus the error's type and code. No customer
    // data, no secrets, no error message.
    console.error(`${label} failed`, { bookingId, ...describeError(err) });
    // A Stripe failure leaves the booking in capture_pending or
    // cancel_pending (SPEC.md section 4: no retry button). A throw before
    // the Stripe call means the database could not be reached.
    return stripeStarted ? "failed" : "db-error";
  }
}

// Approve: charge the hold. The final status, captured, is set by the webhook
// when Stripe confirms, never here.
export async function approveBooking(formData: FormData): Promise<void> {
  // AUTH, the first thing the action does (SPEC.md section 8, CLAUDE.md hard
  // rule 12). Not authorized: throw before any database or Stripe call. This
  // is the pattern in the bundled docs; unauthorized() and forbidden() need
  // an experimental next.config flag.
  // Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md
  //   ("Using the Authorization header")
  // Source: node_modules/next/dist/docs/01-app/02-guides/forms.md
  //   (`throw new Error('Unauthorized')` at the top of the action)
  const authorization = (await headers()).get("authorization");
  if (!isAdminAuthorized(authorization)) {
    throw new Error("Unauthorized");
  }

  const notice = await beginAndSend("capture", formData);

  // redirect() works by throwing, so it sits here, outside any try/catch.
  // The code comes from the fixed Notice list, never from the request.
  // Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md
  //   "redirect throws an error so it should be called outside the try block"
  redirect(`/admin?notice=${notice}`);
}

// Decline: release the hold. The final status, canceled, is set by the
// webhook when Stripe confirms, never here.
export async function declineBooking(formData: FormData): Promise<void> {
  // AUTH, first. Same check and same sources as approveBooking.
  const authorization = (await headers()).get("authorization");
  if (!isAdminAuthorized(authorization)) {
    throw new Error("Unauthorized");
  }

  const notice = await beginAndSend("cancel", formData);

  // Outside any try/catch, as in approveBooking.
  redirect(`/admin?notice=${notice}`);
}
