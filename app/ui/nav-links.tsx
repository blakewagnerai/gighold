"use client";

// The only Client Component in the brand shell. A layout cannot read the
// current URL, so the two top-bar links live here and mark the current page.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md
//   ("Active Nav Links") and .../04-functions/use-pathname.md
// Markup: BWAI brand kit 1.1.0, examples/app.html (a.bwai-topbar__link,
//   aria-current="page" on the current one).
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      <Link
        href="/"
        className="bwai-topbar__link"
        aria-current={pathname === "/" ? "page" : undefined}
      >
        Book
      </Link>
      {/* Admin is a plain anchor, not <Link>: /admin sits behind Basic Auth in
          proxy.ts, so a full navigation gives one browser prompt (a
          client-side fetch gave two). A plain anchor is never prefetched;
          prefetching and client-side navigation are what <Link> adds to <a>.
          Source: node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md */}
      <a
        href="/admin"
        className="bwai-topbar__link"
        aria-current={pathname === "/admin" ? "page" : undefined}
      >
        Admin
      </a>
    </>
  );
}
