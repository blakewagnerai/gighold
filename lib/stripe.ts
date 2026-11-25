// Server-only: this module holds the Stripe secret key (CLAUDE.md hard rule 9).
// Importing it from a Client Component fails the build.
import "server-only";
import Stripe from "stripe";

// One client per server process, created on the first call to getStripe().
// Nothing runs at import time, so `npm run build` does not need the variable.
let client: Stripe | undefined;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    // `!key` is true for both undefined (unset) and "" (empty).
    // The message names the variable and never includes its value.
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }

    // Constructor: `new Stripe('sk_test_...')`.
    // Source: https://github.com/stripe/stripe-node (README, "Usage")
    //
    // API version: `apiVersion` is deliberately not passed. From stripe-node
    // v12 on, requests use the API version that was current when the installed
    // SDK version was released, which keeps the TypeScript types in step with
    // the API. The version is therefore pinned by the exact `stripe` version
    // in package.json (no ^ range).
    // Sources: https://docs.stripe.com/api/versioning?lang=node
    //          https://github.com/stripe/stripe-node (README, "Configuration":
    //          apiVersion defaults to "the latest version at the time of release")
    client = new Stripe(key);
  }
  return client;
}
