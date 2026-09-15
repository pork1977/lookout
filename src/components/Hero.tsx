import LiveDemo from "./LiveDemo";

export default function Hero() {
  return (
    <section id="demo" className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl gap-16 px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Trained in your browser, in seconds
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            Teach your camera to notice anything.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted">
            Describe what you want it to catch, show it a few examples, and it trains itself
            right in your browser. Then it can speak, notify, or message Slack, Discord, or any
            webhook the instant it sees it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#demo-frame"
              className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-strong"
            >
              Try the live demo below
            </a>
            <a
              href="#how-it-works"
              className="rounded-full border border-border-strong px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              See how it works
            </a>
          </div>
        </div>

        <div id="demo-frame">
          <LiveDemo />
        </div>
      </div>
    </section>
  );
}
