// The page header every page renders under the top bar: starfield, emblem,
// one gradient title, one subtitle. A Server Component (no "use client").
// Each page passes its own title and subtitle (SPEC.md section 3a).
// Markup: BWAI brand kit 1.1.0, examples/app.html (header.bwai-header).
type PageHeaderProps = {
  title: string;
  subtitle: string;
};

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <header className="bwai-header">
      <div className="bwai-starfield" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element -- kit markup; decorative emblem sized by kit CSS */}
      <img
        className="bwai-header__emblem"
        src="/brand/bwai-emblem.png"
        alt=""
        aria-hidden="true"
        width={1040}
        height={458}
      />
      {/* No eyebrow: the kit's eyebrow is the app name, which the top bar
          already shows on this HTML surface. */}
      <h1 className="bwai-title">{title}</h1>
      {/* The subtitle also gives the header enough height to show the whole
          emblem: the kit pins the emblem to the top and clips overflow. */}
      <p className="bwai-subtitle">{subtitle}</p>
    </header>
  );
}
