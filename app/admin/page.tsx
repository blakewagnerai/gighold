// The admin page (GigHold M5.2, M5.3): every booking and the last 20 webhook
// events. A Server Component (no "use client"). The page itself only reads;
// the Approve / Decline buttons post to the Server Actions in ./actions.ts.
//
// It renders on every request, never at build time, because it calls
// headers(), a Request-time API. No route segment config is needed.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md
//   "Using it in will opt a route into dynamic rendering."
// Markup: BWAI brand kit 1.1.0, examples/app.html (card, table-scroll, table).
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isAdminAuthorized } from "@/lib/adminAuth";
import { canTransition } from "@/lib/bookingStatus";
import { getSupabase } from "@/lib/supabase";
import { PageHeader } from "../ui/page-header";
import { approveBooking, declineBooking } from "./actions";
import {
  EMPTY,
  formatAmount,
  formatPhoenix,
  formatPhoenixCompact,
  isBookingStatus,
  shortEventId,
  shortId,
  statusClass,
  statusWord,
  type BookingRow,
  type EventRow,
} from "./format";

const TITLE = "Bookings";
const SUBTITLE = "Approve to charge the hold. Decline to release it.";

// The actions send the admin back here as /admin?notice=<code>. Only these
// fixed messages are ever shown; text from the URL is never rendered. Each
// uses a kit badge, which carries a glyph and words, never color alone.
// "started" is the info badge, not success: Stripe has not confirmed yet.
const NOTICES: Record<
  string,
  { message: string; className: string; role: "status" | "alert" }
> = {
  "capture-started": {
    message:
      "Capture sent to Stripe. The status changes to captured when Stripe confirms.",
    className: "bwai-status bwai-status--info",
    role: "status",
  },
  "cancel-started": {
    message:
      "Release sent to Stripe. The status changes to canceled when Stripe confirms.",
    className: "bwai-status bwai-status--info",
    role: "status",
  },
  "in-progress": {
    message:
      "Already in progress, or no longer waiting on a decision. Nothing was sent to Stripe.",
    className: "bwai-status bwai-status--warning",
    role: "status",
  },
  failed: {
    message:
      "Stripe did not confirm. The booking stays pending; check the Stripe Dashboard.",
    className: "bwai-status bwai-status--danger",
    role: "alert",
  },
  "db-error": {
    message:
      "Could not reach the database. Nothing was sent to Stripe; try again.",
    className: "bwai-status bwai-status--danger",
    role: "alert",
  },
};

// The Actions cell for one booking. Which buttons appear is UI-only:
// canTransition enforces nothing, and the action does not trust it. The
// database functions begin_capture / begin_cancel are the referee.
// Each button is its own small form, so the browser posts just that booking's
// id to the Server Action as FormData. No client component is needed.
// Source: node_modules/next/dist/docs/01-app/02-guides/forms.md
//   (`<form action={serverAction}>`; a hidden input carries the id)
// The buttons are stacked, not side by side: the kit has one button size, and
// two of them side by side would push the table past the card's width.
function RowActions({ booking }: { booking: BookingRow }) {
  const { status } = booking;
  if (!isBookingStatus(status)) return EMPTY;
  const canApprove = canTransition(status, "capture_pending");
  const canDecline = canTransition(status, "cancel_pending");
  if (!canApprove && !canDecline) return EMPTY;
  return (
    <div className="flex flex-col items-start gap-2">
      {canApprove ? (
        <form action={approveBooking}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <button type="submit" className="bwai-btn bwai-btn--primary">
            Approve
          </button>
        </form>
      ) : null}
      {canDecline ? (
        <form action={declineBooking}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <button type="submit" className="bwai-btn">
            Decline
          </button>
        </form>
      ) : null}
    </div>
  );
}

// The name of an error's class, for logging. Never the message, which could
// carry data.
function errorType(err: unknown): string {
  return err instanceof Error ? err.constructor.name : typeof err;
}

function LoadFailed() {
  return (
    <>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      {/* The kit's danger badge carries a glyph and words, never color alone. */}
      <p role="alert" className="bwai-status bwai-status--danger">
        Could not load bookings
      </p>
    </>
  );
}

export default async function Admin({ searchParams }: PageProps<"/admin">) {
  // AUTH RE-CHECK, the first thing the page does (SPEC.md section 8, CLAUDE.md
  // hard rule 12). proxy.ts is the front door; this is the second lock, in
  // case a request ever reaches the page without passing the proxy
  // (CVE-2025-29927).
  // headers() is async and returns a read-only Web Headers object.
  // Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/headers.md
  //   ("Using the Authorization header")
  const authorization = (await headers()).get("authorization");
  if (!isAdminAuthorized(authorization)) {
    // notFound() throws, so nothing below this line runs: no Supabase client
    // is created and no query is sent. It answers 404 with the not-found UI.
    // It sits outside any try/catch, because a catch would swallow the throw.
    // unauthorized() and forbidden() would fit better by name, but both are
    // experimental and need a next.config flag.
    // Source: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md
    notFound();
  }

  // The notice code, read only after the auth check. searchParams is a
  // promise in this Next.js version.
  // Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
  // Object.hasOwn: only our own five keys match, never an inherited one, and
  // a repeated ?notice= (an array) matches nothing.
  const { notice: noticeCode } = await searchParams;
  const notice =
    typeof noticeCode === "string" && Object.hasOwn(NOTICES, noticeCode)
      ? NOTICES[noticeCode]
      : undefined;

  // The rows stay null if the load fails. The failure page is returned after
  // the try/catch, not inside it: React's lint rule forbids building JSX in a
  // try block, because a try/catch cannot catch errors from rendering it.
  let bookings: BookingRow[] | null = null;
  let events: EventRow[] | null = null;
  try {
    const supabase = getSupabase();

    // Both reads run at the same time. supabase-js reports a failure in
    // `error` instead of throwing.
    const [bookingsResult, eventsResult] = await Promise.all([
      // All bookings, newest first.
      // Source: https://supabase.com/docs/reference/javascript/select
      //   .select('id, name') takes a comma-separated column list.
      // Source: https://supabase.com/docs/reference/javascript/order
      //   .order('id', { ascending: false })
      supabase
        .from("bookings")
        .select(
          "id, customer_name, customer_email, event_date, amount_cents, currency, status, payment_intent_id, capture_before, created_at",
        )
        .order("created_at", { ascending: false }),
      // The 20 most recently received webhook events.
      // Source: https://supabase.com/docs/reference/javascript/select
      // Source: https://supabase.com/docs/reference/javascript/order
      // Source: https://supabase.com/docs/reference/javascript/limit
      //   .limit(1) caps the number of rows returned.
      supabase
        .from("stripe_events")
        .select("id, type, booking_id, outcome, delivery_count, last_received_at")
        .order("last_received_at", { ascending: false })
        .limit(20),
    ]);

    if (bookingsResult.error || eventsResult.error) {
      // Only the error codes (e.g. Postgres "42501"). No rows, no customer
      // data, no error message.
      console.error("admin load failed", {
        bookingsErrorCode: bookingsResult.error?.code ?? null,
        eventsErrorCode: eventsResult.error?.code ?? null,
      });
    } else {
      bookings = bookingsResult.data as BookingRow[];
      events = eventsResult.data as EventRow[];
    }
  } catch (err) {
    // getSupabase() throws if its variables are unset, and a network failure
    // can throw too. Log the error's type only.
    console.error("admin load failed", { errorType: errorType(err) });
  }

  if (bookings === null || events === null) {
    return <LoadFailed />;
  }

  return (
    <>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />

      {notice ? (
        <p role={notice.role} className={notice.className}>
          {notice.message}
        </p>
      ) : null}

      {/* Desktop fit (M5.3): at the kit's full width both tables fit their
          card with no sideways scroll. Below Tailwind's lg breakpoint
          (1024px) name and email stay on one line, so on a phone the table
          keeps its natural width and scrolls inside its card. */}
      <section className="bwai-card">
        {/* h2, where the kit example has h3: the only heading above it on
            this page is the h1 title. The class sets the look. */}
        <h2 className="bwai-card__title">Bookings</h2>
        {/* bwai-table-scroll is overflow-x: auto, so on a phone the table
            scrolls sideways and the page does not. */}
        <div className="bwai-table-scroll">
          <table className="bwai-table">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Customer</th>
                <th>Email</th>
                <th>Event date</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Hold expires (MST)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={8}>No bookings yet.</td>
                </tr>
              ) : (
                bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td className="whitespace-nowrap" title={booking.id}>
                      {shortId(booking.id)}
                    </td>
                    {/* From lg up the name wraps between words and the
                        email may break anywhere (an address has no spaces). */}
                    <td className="max-lg:whitespace-nowrap">
                      {booking.customer_name}
                    </td>
                    <td className="max-lg:whitespace-nowrap lg:wrap-anywhere">
                      {booking.customer_email}
                    </td>
                    <td className="whitespace-nowrap">{booking.event_date}</td>
                    <td className="num">
                      {formatAmount(booking.amount_cents, booking.currency)}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={statusClass(booking.status)}>
                        {statusWord(booking.status)}
                      </span>
                    </td>
                    {/* Compact on screen; the full date, year and zone
                        on hover. */}
                    <td
                      className="whitespace-nowrap"
                      title={
                        booking.capture_before
                          ? formatPhoenix(booking.capture_before)
                          : undefined
                      }
                    >
                      {formatPhoenixCompact(booking.capture_before)}
                    </td>
                    <td className="whitespace-nowrap">
                      <RowActions booking={booking} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bwai-card">
        <h2 className="bwai-card__title">Webhook events</h2>
        <div className="bwai-table-scroll">
          <table className="bwai-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Type</th>
                <th>Booking</th>
                <th>Outcome</th>
                <th className="num">Deliveries</th>
                <th>Last received (MST)</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6}>No webhook events yet.</td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap" title={event.id}>
                      {shortEventId(event.id)}
                    </td>
                    <td className="whitespace-nowrap">{event.type}</td>
                    <td
                      className="whitespace-nowrap"
                      title={event.booking_id ?? undefined}
                    >
                      {event.booking_id ? shortId(event.booking_id) : EMPTY}
                    </td>
                    <td>{event.outcome ?? EMPTY}</td>
                    <td className="num">{event.delivery_count}×</td>
                    <td
                      className="whitespace-nowrap"
                      title={formatPhoenix(event.last_received_at)}
                    >
                      {formatPhoenixCompact(event.last_received_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
