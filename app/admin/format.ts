// Display helpers and row types for the /admin page (GigHold M5.2).
// Pure functions: no secrets, no database, no network. Nothing here changes
// data; it only turns stored values into text for the tables.
import { BOOKING_STATUSES, type BookingStatus } from "@/lib/bookingStatus";

// The columns the page selects (SPEC.md section 6). The project has no
// generated database types (SPEC.md section 4), so the shapes are written by
// hand. Postgres timestamptz and date values arrive from the Data API as
// strings.
export type BookingRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  event_date: string; // YYYY-MM-DD
  amount_cents: number;
  currency: string;
  status: string;
  payment_intent_id: string | null;
  capture_before: string | null;
  created_at: string;
};

export type EventRow = {
  id: string;
  type: string;
  booking_id: string | null;
  outcome: string | null;
  delivery_count: number;
  last_received_at: string;
};

// Arizona time, the same zone lib/bookingValidation.ts uses for "today".
// Repeated here because that file does not export its constant. Arizona does
// not observe daylight saving time, so the zone is MST (UTC-7) all year.
const TIME_ZONE = "America/Phoenix";

// What an empty cell shows.
export const EMPTY = "—";

// First 8 characters of a uuid: enough to tell rows apart on screen.
export function shortId(id: string): string {
  return id.slice(0, 8);
}

// 15000 + "usd" -> "$150.00". Display only: the amount is never sent
// anywhere from here. Dividing by 100 assumes a two-decimal currency, which
// holds for USD, the only currency this app uses.
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat
export function formatAmount(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    // Intl throws a RangeError for a currency code it does not accept.
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

// An ISO timestamp -> "Nov 25, 2026, 3:04 PM MST", or "—" when there is none.
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
export function formatPhoenix(iso: string | null): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  // An unparseable string gives an "Invalid Date", whose time is NaN.
  if (Number.isNaN(date.getTime())) return EMPTY;
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  return `${text} MST`;
}

// Narrows a plain string from the database to one of the six statuses, so
// canTransition can be called with it. The database CHECK constraint already
// limits the column to these six; this guard is for TypeScript, and for
// safety if the two lists ever drift apart.
export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

// "pending_payment" -> "pending payment".
export function statusWord(status: string): string {
  return status.replaceAll("_", " ");
}

// Which of the kit's four badge variants each status uses. The badge always
// carries the status word and the kit's glyph, never color alone.
const STATUS_VARIANT: Record<BookingStatus, string> = {
  pending_payment: "bwai-status--info",
  authorized: "bwai-status--warning", // waiting on the admin's decision
  capture_pending: "bwai-status--info",
  captured: "bwai-status--success",
  cancel_pending: "bwai-status--info",
  canceled: "bwai-status--danger",
};

export function statusClass(status: string): string {
  const variant = isBookingStatus(status)
    ? STATUS_VARIANT[status]
    : "bwai-status--info";
  return `bwai-status ${variant}`;
}
