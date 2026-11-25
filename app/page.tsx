// The booking page (GigHold M3.2): page header, one highlight card, and the
// form inside a card. A Server Component; the form posts to the createBooking
// Server Action.
// Markup: BWAI brand kit 1.1.0, examples/app.html.
import { todayInPhoenix } from "@/lib/bookingValidation";
import { createBooking } from "./actions";
import { PageHeader } from "./ui/page-header";

// createBooking sends a rejected submit back here as /?error=<code>. Only
// these fixed messages are ever shown; text from the URL is never rendered.
const ERROR_MESSAGES: Record<string, string> = {
  name: "Enter your name (100 characters or fewer).",
  email: "Enter a valid email address.",
  date: "Choose an event date that is today or later.",
  failed:
    "Something went wrong and your booking was not completed. No card was charged. Please try again.",
};

// The kit (1.1.0) has no form-field component. Blake's decision for M3.2:
// reuse existing kit classes on native inputs. bwai-inset gives the fill,
// border, radius and padding; bwai-focusable the kit focus ring;
// bwai-t-app-body the font. The Tailwind utilities carry no color value:
// text-inherit takes the card's text color, scheme-dark makes the browser
// draw the date picker for a dark page.
const FIELD_CLASS =
  "bwai-inset bwai-focusable bwai-t-app-body w-full text-inherit scheme-dark";

// searchParams is a promise in this Next.js version, and reading it makes the
// page render on each request instead of once at build time.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
export default async function Home({ searchParams }: PageProps<"/">) {
  const { error } = await searchParams;
  // Object.hasOwn: only our own four keys match, never an inherited one.
  const message =
    typeof error === "string" && Object.hasOwn(ERROR_MESSAGES, error)
      ? ERROR_MESSAGES[error]
      : undefined;

  return (
    <>
      <PageHeader
        title="Book the band"
        subtitle="Tell us your event date. The band reviews it and confirms."
      />

      {/* Display text from SPEC.md section 3a. It is a known duplicate of the
          database default (migration 0002); the page does not read the
          amount from the database. */}
      <section
        className="bwai-highlight"
        aria-label="$150 deposit · held, not charged until we confirm"
      >
        <p className="bwai-highlight__value">$150 deposit</p>
        <p className="bwai-highlight__meta">
          held, not charged until we confirm
        </p>
      </section>

      <section className="bwai-card">
        {/* Passing a Server Action to `action` makes the browser post the
            form's fields to it as FormData.
            Source: node_modules/next/dist/docs/01-app/02-guides/forms.md */}
        <form action={createBooking} className="flex flex-col gap-4">
          {message ? (
            // The kit's danger badge carries a glyph and words, never color
            // alone. role="alert" has screen readers announce it.
            <p role="alert" className="bwai-status bwai-status--danger">
              {message}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <label className="bwai-card__label" htmlFor="name">
              Your name
            </label>
            <input
              className={FIELD_CLASS}
              id="name"
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="name"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="bwai-card__label" htmlFor="email">
              Email
            </label>
            <input
              className={FIELD_CLASS}
              id="email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="bwai-card__label" htmlFor="event_date">
              Event date
            </label>
            {/* min is a convenience for the browser's date picker. The real
                check is validateBooking on the server. */}
            <input
              className={FIELD_CLASS}
              id="event_date"
              name="event_date"
              type="date"
              required
              min={todayInPhoenix()}
            />
          </div>

          <div>
            <button type="submit" className="bwai-btn bwai-btn--primary">
              Continue to payment
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
