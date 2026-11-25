"use server";
// Every export of a "use server" file is a Server Action: it runs only on the
// server, and a <form action={...}> can call it.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md
//   and node_modules/next/dist/docs/01-app/02-guides/forms.md

import { redirect } from "next/navigation";
import Stripe from "stripe";
import { validateBooking } from "@/lib/bookingValidation";
import { getStripe } from "@/lib/stripe";
import { getSupabase } from "@/lib/supabase";

// Throws an Error whose name is a short, fixed label. The catch block below
// logs only that label, so nothing a customer typed can reach the logs.
function fail(type: string): never {
  const error = new Error(type);
  error.name = type;
  throw error;
}

// The error type for the server log: Stripe's own type (for example
// "StripeInvalidRequestError"), or the error's name. Never the message.
function errorType(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) return err.type;
  if (err instanceof Error) return err.name;
  return "unknown";
}

// Creates a pending_payment booking, opens a Stripe Checkout Session that
// puts the deposit on hold, and sends the customer to Stripe.
export async function createBooking(formData: FormData): Promise<void> {
  // (a) Read only these three fields. Any other field in the request,
  // including an amount or a status, is never looked at (hard rule 7).
  const checked = validateBooking({
    name: formData.get("name"),
    email: formData.get("email"),
    eventDate: formData.get("event_date"),
  });

  // (c) Invalid input: back to / with a fixed code. Nothing has been written.
  if (!checked.ok) {
    redirect(`/?error=${checked.code}`);
  }
  const { name, email, eventDate } = checked.value;

  // Configuration is checked before any write, and outside the try block, so
  // a misconfigured server fails loudly, names the variable, and leaves no
  // row behind. `!siteUrl` is true for both unset and empty.
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    throw new Error("SITE_URL is not set");
  }
  const supabase = getSupabase(); // throws naming its variable if unset
  const stripe = getStripe(); // throws naming its variable if unset

  let bookingId: string | undefined;
  let checkoutUrl: string | undefined;

  try {
    // (d) Insert naming only the three customer columns. amount_cents and
    // currency come from the column defaults (migrations 0001 and 0002);
    // service_role has no INSERT grant on either, so the database is their
    // only source. Chaining .select() makes the insert return the new row
    // (Postgres RETURNING, the counterpart of T-SQL's OUTPUT inserted.*);
    // .single() returns one object instead of an array.
    // Source: https://supabase.com/docs/reference/javascript/insert
    //   "By default, inserted rows are not returned. To return it, chain the
    //   call with .select()."
    // Source: https://supabase.com/docs/reference/javascript/single
    // supabase-js reports a failure in `error` instead of throwing.
    const { data, error } = await supabase
      .from("bookings")
      .insert({
        customer_name: name,
        customer_email: email,
        event_date: eventDate,
      })
      .select("id, amount_cents, currency")
      .single();

    if (error) {
      // error.code is a Postgres or PostgREST code such as "42501". The
      // message is not used: Postgres messages can quote row values.
      fail(`supabase_insert:${error.code || "unknown"}`);
    }

    const row = data as {
      id: unknown;
      amount_cents: unknown;
      currency: unknown;
    } | null;
    if (!row || typeof row.id !== "string" || row.id === "") {
      fail("booking_id_missing");
    }
    bookingId = row.id;

    const amountCents = row.amount_cents;
    if (
      typeof amountCents !== "number" ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0
    ) {
      fail("amount_not_positive_integer");
    }
    const currency = row.currency;
    if (typeof currency !== "string" || currency === "") {
      fail("currency_missing");
    }

    // (e) Checkout Session per SPEC.md section 9.
    // Source: https://docs.stripe.com/api/checkout/sessions/create
    //   mode "payment"; line_items[].price_data with currency, unit_amount
    //   (in cents) and product_data.name; success_url; cancel_url.
    // Source: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
    //   "specify capture_method as manual when creating the Checkout Session.
    //   This parameter instructs Stripe to authorize the amount but not
    //   capture it on the customer's payment method."
    // Source: https://docs.stripe.com/metadata
    //   "Data you include with the payment_intent_data.metadata attribute
    //   saves to the underlying PaymentIntent's metadata." The webhook (M4)
    //   reads booking_id from there.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountCents,
            product_data: { name: "Booking deposit" },
          },
        },
      ],
      payment_intent_data: {
        capture_method: "manual",
        metadata: { booking_id: bookingId },
      },
      success_url: `${siteUrl}/thanks`,
      cancel_url: `${siteUrl}/`,
    });

    // The API reference lists `url` as a nullable string.
    if (!session.url) {
      fail("checkout_url_missing");
    }
    checkoutUrl = session.url;
  } catch (err) {
    // (g) Server log: the booking id (if the insert got that far) and the
    // error type. No customer data, no secrets, no error message.
    // A booking whose Stripe call failed stays pending_payment. App code
    // never updates or deletes a booking (hard rule 8).
    console.error("createBooking failed", {
      bookingId: bookingId ?? null,
      errorType: errorType(err),
    });
  }

  // (f) redirect() works by throwing a special error, so it must sit outside
  // the try block; inside, the catch above would treat it as a failure.
  // Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md
  //   "redirect throws an error so it should be called outside the try block"
  if (!checkoutUrl) {
    redirect("/?error=failed");
  }
  redirect(checkoutUrl);
}
