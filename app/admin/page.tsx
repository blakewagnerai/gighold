// The admin page (GigHold M5.2): every booking and the last 20 webhook
// events. A Server Component (no "use client"). Read-only in this step:
// M5.3 adds the Approve / Decline Server Actions.
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
import {
  EMPTY,
  formatAmount,
  formatPhoenix,
  isBookingStatus,
  shortId,
  statusClass,
  statusWord,
  type BookingRow,
  type EventRow,
} from "./format";

const TITLE = "Bookings";
const SUBTITLE = "Approve to charge the hold. Decline to release it.";

// The words the Actions column shows for a status. UI-only (canTransition
// enforces nothing; the database is the referee). In M5.2 these are plain
// words, not buttons: the kit has no disabled-button style (Blake's decision,
// 2026-11-25). M5.3 replaces them with real buttons.
function actionWords(status: string): string {
  if (!isBookingStatus(status)) return EMPTY;
  const words: string[] = [];
  if (canTransition(status, "capture_pending")) words.push("Approve");
  if (canTransition(status, "cancel_pending")) words.push("Decline");
  return words.length > 0 ? words.join(" · ") : EMPTY;
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

export default async function Admin() {
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
                <th>Hold expires</th>
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
                    <td>{booking.customer_name}</td>
                    <td>{booking.customer_email}</td>
                    <td className="whitespace-nowrap">{booking.event_date}</td>
                    <td className="num">
                      {formatAmount(booking.amount_cents, booking.currency)}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className={statusClass(booking.status)}>
                        {statusWord(booking.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      {formatPhoenix(booking.capture_before)}
                    </td>
                    <td className="whitespace-nowrap">
                      {actionWords(booking.status)}
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
                <th>Last received</th>
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
                    <td className="whitespace-nowrap">{event.id}</td>
                    <td className="whitespace-nowrap">{event.type}</td>
                    <td
                      className="whitespace-nowrap"
                      title={event.booking_id ?? undefined}
                    >
                      {event.booking_id ? shortId(event.booking_id) : EMPTY}
                    </td>
                    <td>{event.outcome ?? EMPTY}</td>
                    <td className="num">{event.delivery_count}×</td>
                    <td className="whitespace-nowrap">
                      {formatPhoenix(event.last_received_at)}
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
