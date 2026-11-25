// The thanks page (GigHold M3.3): where Stripe Checkout sends the browser
// back. Page header, one highlight card, one short card, a link home.
//
// The page reads nothing: no searchParams, no database, no Stripe. Landing
// here is only a browser redirect, not proof of payment; the webhook (M4) is
// the truth.
//
// Because it uses no Request-time API, Next.js renders it once at build time
// (static). Reading searchParams would switch it to rendering on each request.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
//   and .../01-app/02-guides/caching-without-cache-components.md (dynamic = 'auto')
// Markup: BWAI brand kit 1.1.0, examples/app.html.
import Link from "next/link";
import { PageHeader } from "../ui/page-header";

export default function Thanks() {
  return (
    <>
      <PageHeader
        title="You're on hold"
        subtitle="Request received. The band will take it from here."
      />

      {/* Display text from SPEC.md section 3a. "$150.00" is a known duplicate
          of the database default (migration 0002); the page does not read the
          amount from the database. */}
      <section
        className="bwai-highlight"
        aria-label="Hold placed · $150.00 · You have not been charged"
      >
        <p className="bwai-highlight__label">Hold placed</p>
        <p className="bwai-highlight__value">$150.00</p>
        <p className="bwai-highlight__meta">You have not been charged</p>
      </section>

      <section className="bwai-card">
        {/* h2, where the kit example has h3: the only heading above it on
            this page is the h1 title. The class sets the look. */}
        <h2 className="bwai-card__title">What happens next</h2>
        {/* "about 7 days" is Stripe's default authorization window for online
            card payments, not this booking's actual deadline, which arrives
            later as capture_before.
            Source: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
            "$150" is display text, the same known duplicate as above.
            The text sits in a string so the apostrophe needs no escaping. */}
        <p className="bwai-card__body">
          {
            "The band reviews your date. If they confirm, your card is charged $150. If they decline, or don't confirm within about 7 days, the hold is released and you pay nothing."
          }
        </p>
      </section>

      <p className="bwai-t-app-body">
        {/* Source: node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md */}
        <Link className="bwai-link" href="/">
          Book another date
        </Link>
      </p>
    </>
  );
}
