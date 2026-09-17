const steps = [
  {
    number: "01",
    title: "Say what to notice",
    body: "Describe it in your own words, or start from an idea such as “tell me when I bring a drink to my desk” or “tell me when someone walks up behind me”.",
  },
  {
    number: "02",
    title: "Show it a few examples",
    body: "Take some photos with your webcam or upload them. Claude can check them and flag any that look like they're in the wrong group.",
  },
  {
    number: "03",
    title: "Train it in the browser",
    body: "A small model is trained on your examples in the page. It usually takes a few seconds, and your photos aren't sent to a server.",
  },
  {
    number: "04",
    title: "Pick what happens next",
    body: "When it sees what you trained it for, it can speak a phrase, show a notification, message Slack or Discord, call a webhook, or send an email.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            How it works
          </h2>
          <p className="mt-4 text-muted">
            Building a detector takes four steps and doesn&apos;t involve writing code or
            collecting a dataset.
          </p>
        </div>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="relative rounded-2xl border border-border bg-surface p-6 transition-all hover:border-border-strong hover:shadow-[0_20px_60px_-30px_var(--glow)]"
            >
              <span className="font-mono text-sm text-accent">{step.number}</span>
              <h3 className="mt-3 font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
