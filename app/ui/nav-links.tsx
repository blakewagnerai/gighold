"use client";

// The only Client Component in the brand shell. A layout cannot read the
// current URL, so the two top-bar links live here and mark the current page.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md
//   ("Active Nav Links") and .../04-functions/use-pathname.md
// Markup: BWAI brand kit 1.1.0, examples/app.html (a.bwai-topbar__link,
//   aria-current="page" on the current one).
import Link from "next/link";
import { usePathname } from "next/navigation";

// `prefetch` is optional (the `?`): Book leaves it out and keeps the default.
const LINKS: { href: string; label: string; prefetch?: false }[] = [
  { href: "/", label: "Book" },
  // prefetch={false}: prefetching /admin hits the Basic Auth gate in proxy.ts (401), so the browser would prompt on public pages. Source: node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md ("prefetch")
  { href: "/admin", label: "Admin", prefetch: false },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {LINKS.map(({ href, label, prefetch }) => (
        <Link
          key={href}
          href={href}
          prefetch={prefetch}
          className="bwai-topbar__link"
          aria-current={pathname === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </>
  );
}
