"use client";

// The only Client Component in the brand shell. A layout cannot read the
// current URL, so the two top-bar links live here and mark the current page.
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md
//   ("Active Nav Links") and .../04-functions/use-pathname.md
// Markup: BWAI brand kit 1.1.0, examples/app.html (a.bwai-topbar__link,
//   aria-current="page" on the current one).
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Book" },
  { href: "/admin", label: "Admin" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="bwai-topbar__link"
          aria-current={pathname === href ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </>
  );
}
