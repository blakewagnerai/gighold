// Booking statuses and two small pure helpers (GigHold M4.5, SPEC sections 5
// and 9). No imports, no secrets, no database: safe to use from any file and
// to unit-test (U1, U2).

// The six statuses of SPEC section 5, in the spec's order. `as const` keeps
// the exact words as types instead of widening them to `string`.
export const BOOKING_STATUSES = [
  "pending_payment",
  "authorized",
  "capture_pending",
  "captured",
  "cancel_pending",
  "canceled",
] as const;

// A union type built from the array: "pending_payment" | "authorized" | ...
// One list feeds both the type and anything that loops over the statuses.
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// The eight allowed transitions of SPEC section 5: for each status, the
// statuses it may move to. This mirrors the bookings_guard trigger
// (supabase/migrations/0001_init.sql). `Record<BookingStatus, ...>` makes
// TypeScript insist on an entry for every status.
const ALLOWED_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending_payment: ["authorized", "canceled"],
  authorized: ["capture_pending", "cancel_pending", "canceled"],
  capture_pending: ["captured", "canceled"],
  captured: [],
  cancel_pending: ["canceled"],
  canceled: [],
};

// UI-only: it decides which buttons the admin page shows. It enforces
// nothing. The database trigger is the referee, and status changes still go
// only through the database functions (CLAUDE.md hard rule 8).
// A status "moving" to itself is not a transition, so it returns false.
export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// The Stripe idempotency key for an admin action (SPEC section 9):
// "capture:<booking id>" or "cancel:<booking id>". The same booking and
// action always give the same key, so a retried request cannot act twice.
export function idempotencyKey(
  action: "capture" | "cancel",
  bookingId: string,
): string {
  return `${action}:${bookingId}`;
}
