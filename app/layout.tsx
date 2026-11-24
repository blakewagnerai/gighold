import type { Metadata } from "next";
import Link from "next/link";
// Global CSS is imported once, here in the root layout. Order matters: Tailwind
// first, then the brand kit, so the kit's classes are declared last.
// Source: node_modules/next/dist/docs/01-app/01-getting-started/11-css.md
import "./globals.css";
// BWAI brand kit 1.1.0, copied unchanged from the bwai-brand skill.
// bwai-fonts.css loads the nine self-hosted faces from ./brand/fonts/.
import "./brand/bwai-fonts.css";
import "./brand/bwai.css";
import { NavLinks } from "./ui/nav-links";

const APP_NAME = "GigHold";

// Brand names are read from the kit, never typed from memory.
// Source: BWAI brand kit 1.1.0, tokens/bwai.recipes.json -> brand
const BRAND = {
  labs: "BWAI Labs",
  labsWordmark: "BWAI LABS",
  tagline: "IMAGINE. AUTOMATE. EVOLVE.",
};

// Static metadata. The tab icons are not listed here: Next.js picks up
// app/favicon.ico, app/icon.svg and app/apple-icon.png by file name.
// Source: node_modules/next/dist/docs/01-app/01-getting-started/14-metadata-and-og-images.md
//   and .../03-api-reference/03-file-conventions/01-metadata/app-icons.md
export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} is a ${BRAND.labs} demo: a gig-booking deposit that is held, not charged, until the band confirms.`,
};

// Root layout: the brand frame every page sits inside (top bar, page ground,
// footer). Each page renders its own page header, because the title differs
// per page (SPEC.md section 3a).
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md
// Markup: BWAI brand kit 1.1.0, examples/app.html
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className="h-full">
      <body className="bwai-surface" data-intensity="app">
        <header className="bwai-topbar">
          {/* Source: node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md */}
          <Link className="bwai-topbar__brand" href="/">
            {/* The kit's CSS shows the lockup above 640px and the mark alone
                at 640px and below. Plain <img>: the kit sizes them by class. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- kit markup; SVG sized by kit CSS */}
            <img
              className="bwai-topbar__lockup"
              src="/brand/bwai-labs-lockup.svg"
              alt={BRAND.labs}
              width={173}
              height={24}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- kit markup; SVG sized by kit CSS */}
            <img
              className="bwai-topbar__mark"
              src="/brand/bwai-mark.svg"
              alt={BRAND.labs}
              width={60}
              height={24}
            />
            <span className="bwai-topbar__app">{APP_NAME}</span>
          </Link>
          <nav className="bwai-topbar__nav" aria-label="Pages">
            <NavLinks />
          </nav>
        </header>

        {/* Tailwind for layout only: the kit example's .main rule
            (1100px max, 16px side padding, 48px above the kit's 640px breakpoint, 24px gap). */}
        <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 min-[641px]:px-12">
          {children}

          <footer className="bwai-footer">
            {/* eslint-disable-next-line @next/next/no-img-element -- kit markup; decorative band sized by kit CSS */}
            <img
              className="bwai-footer__band"
              src="/brand/bwai-stage-band.png"
              alt=""
              aria-hidden="true"
              width={1920}
              height={128}
            />
            <div className="bwai-footer__row">
              <p className="bwai-wordmark">{BRAND.labsWordmark}</p>
              <p className="bwai-tagline">{BRAND.tagline}</p>
            </div>
          </footer>
        </main>
      </body>
    </html>
  );
}
