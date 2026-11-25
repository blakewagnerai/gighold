// The one admin auth check (SPEC.md §8, CLAUDE.md hard rule 12).
// Called from proxy.ts now; the /admin page (M5.2) and every admin Server
// Action (M5.3) call it too. It takes a plain string so it has no Next.js
// request types and works the same from all three places.
//
// Server-only: this module reads ADMIN_USER and ADMIN_PASSWORD.
// Importing it from a Client Component fails the build.
import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

// Standard base64 only: A-Z a-z 0-9 + /, with at most two "=" at the end.
// Needed because Buffer.from(text, "base64") never throws: it silently skips
// characters that are not base64, so bad input has to be rejected up front.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const SCHEME = "Basic ";

// SHA-256 of a string, as a 32-byte Buffer.
function sha256(text: string): Buffer {
  // createHash(algorithm) returns a Hash; update(string) treats the string as
  // UTF-8 by default; digest() with no encoding returns a Buffer.
  // Source: https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options
  //         https://nodejs.org/api/crypto.html#hashupdatedata-inputencoding
  //         https://nodejs.org/api/crypto.html#hashdigestencoding
  return createHash("sha256").update(text).digest();
}

/**
 * True only when `authorizationHeader` is a valid HTTP Basic header carrying
 * the configured admin user and password. Every other case returns false.
 * Never logs, throws or returns anything that contains the header, the decoded
 * value or an environment value.
 */
export function isAdminAuthorized(authorizationHeader: string | null): boolean {
  // Read at call time, not import time, so `npm run build` needs no variables
  // (same pattern as lib/stripe.ts).
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  // FAIL CLOSED. `!value` is true for both undefined (unset) and "" (empty).
  // This runs before the header is looked at, so with no credentials
  // configured nothing can ever be compared, let alone match.
  if (!user || !password) {
    return false;
  }

  // No header, or not the Basic scheme.
  if (authorizationHeader === null || !authorizationHeader.startsWith(SCHEME)) {
    return false;
  }

  // Not valid base64. Real base64 is always a multiple of 4 characters long.
  const encoded = authorizationHeader.slice(SCHEME.length);
  if (encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    return false;
  }

  // The decoded value must be "user:password", so it must contain a colon.
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (decoded.indexOf(":") === -1) {
    return false;
  }

  // The user ends at the FIRST colon; everything after it is the password,
  // colons included. Comparing the whole decoded "user:password" against
  // ADMIN_USER + ":" + ADMIN_PASSWORD gives exactly that rule, without ever
  // holding the two parts as separate strings that could be compared with ===.
  //
  // Constant-time compare. Hashing first makes both sides exactly 32 bytes
  // whatever was typed, which matters twice: timingSafeEqual throws if the
  // byte lengths differ, and a length difference would itself leak
  // information. Credentials are never compared with === anywhere.
  // Source: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
  //   "An error is thrown if a and b have different byte lengths."
  return timingSafeEqual(sha256(decoded), sha256(`${user}:${password}`));
}
