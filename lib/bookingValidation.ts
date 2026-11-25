// Validation for the booking form (GigHold M3.2). Pure functions: no secrets,
// no database, no network. They live outside app/actions.ts because a
// "use server" file may export only async functions.

// "Today" for GigHold is Arizona time (Blake's decision). Arizona does not
// observe daylight saving time, so America/Phoenix is UTC-7 all year.
const TIME_ZONE = "America/Phoenix";

export type BookingInput = {
  name: string;
  email: string;
  eventDate: string; // YYYY-MM-DD
};

// Which field to fix. The page turns the code into a message.
export type BookingErrorCode = "name" | "email" | "date";

export type BookingValidation =
  | { ok: true; value: BookingInput }
  | { ok: false; code: BookingErrorCode };

// Today's date in Arizona as YYYY-MM-DD.
// Intl.DateTimeFormat is built into Node; formatToParts returns the year,
// month and day as separate strings, so the result does not depend on a
// locale's date layout.
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts
export function todayInPhoenix(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// True only for a real calendar date written as YYYY-MM-DD.
function isRealDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC rolls an impossible date forward (Feb 30 becomes Mar 2), so a
  // date is real only if it comes back unchanged.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Something@something.something with no spaces. Deliberately loose: the only
// real proof of an address is delivering mail to it, and GigHold sends none.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The values are `unknown` because a FormData entry can be a string, a File,
// or missing (null). Anything that is not a string fails its field.
export function validateBooking(
  raw: { name: unknown; email: unknown; eventDate: unknown },
  now: Date = new Date(),
): BookingValidation {
  // Name: trimmed, 1 to 100 characters (SPEC.md section 6).
  if (typeof raw.name !== "string") return { ok: false, code: "name" };
  const name = raw.name.trim();
  if (name.length < 1 || name.length > 100) return { ok: false, code: "name" };

  // Email: trimmed, at most 254 characters, plausible shape.
  if (typeof raw.email !== "string") return { ok: false, code: "email" };
  const email = raw.email.trim();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, code: "email" };
  }

  // Event date: a real YYYY-MM-DD date, today or later in Arizona.
  // Two YYYY-MM-DD strings compare correctly as plain text.
  if (typeof raw.eventDate !== "string") return { ok: false, code: "date" };
  const eventDate = raw.eventDate.trim();
  if (!isRealDate(eventDate) || eventDate < todayInPhoenix(now)) {
    return { ok: false, code: "date" };
  }

  return { ok: true, value: { name, email, eventDate } };
}
