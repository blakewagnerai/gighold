// Placeholder home page (M1.5). The booking form and the highlight card
// arrive in a later step.
// Markup: BWAI brand kit 1.1.0, examples/app.html (header.bwai-header).
export default function Home() {
  return (
    <>
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
        {/* No eyebrow yet: the kit's eyebrow is the app name, which would
            repeat this title. */}
        <h1 className="bwai-title">GigHold</h1>
        {/* The subtitle also gives the header enough height to show the
            whole emblem: the kit pins the emblem to the top and clips overflow. */}
        <p className="bwai-subtitle">Coming soon</p>
      </header>
    </>
  );
}
