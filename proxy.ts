// Next.js 16 proxy: the Basic Auth front door for /admin (SPEC.md §3, §8).
// It is the front door, not the only lock: the /admin page and every admin
// Server Action call isAdminAuthorized again (SPEC.md §15, CVE-2025-29927).
//
// File convention: proxy.ts in the project root, exporting a function named
// `proxy`. This replaces middleware.ts in Next.js 16.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
//         https://nextjs.org/docs/app/api-reference/file-conventions/proxy
//
// Runtime: no `runtime` export here on purpose. The same doc ("Runtime") says
// Proxy defaults to the Node.js runtime and that setting the `runtime` config
// option in a Proxy file throws an error. Node.js is what makes node:crypto
// available to lib/adminAuth.ts.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAdminAuthorized } from "@/lib/adminAuth";

export function proxy(request: NextRequest) {
  // Pass: NextResponse.next() continues to the route with the request unchanged.
  // Source: proxy.md, "NextResponse" and "Using Cookies" example.
  if (isAdminAuthorized(request.headers.get("authorization"))) {
    return NextResponse.next();
  }

  // Fail: answer directly from the proxy; the route never runs.
  // Source: proxy.md, "Producing a response" (return a Response with status 401).
  //
  // WWW-Authenticate is what makes the browser show its login box. Basic
  // requires a quoted `realm`; `charset` is optional and "UTF-8" is its only
  // allowed value.
  // Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/WWW-Authenticate
  // A string body is sent as text/plain;charset=UTF-8.
  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="GigHold admin", charset="UTF-8"',
    },
  });
}

// `:path*` means zero or more path segments, so this matches /admin itself and
// everything under it. The value must be a constant so Next.js can read it at
// build time.
// Source: proxy.md, "Matcher".
export const config = {
  matcher: "/admin/:path*",
};
