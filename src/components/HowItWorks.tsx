const steps = [
  {
    number: "01",
    title: "Say what to notice",
    body: "Describe it in plain English, or pick one of ours: “tell me when I bring a drink to my desk”, “tell me when someone walks up behind me”.",
  },
  {
    number: "02",
    title: "Show it a few examples",
    body: "Snap a handful of photos with your webcam or upload some. Claude helps label them, you only review the ones it's unsure about.",
  },
  {
    number: "03",
    title: "It trains itself, on the spot",
    body: "Your browser trains a small custom model on your examples in seconds. No queue, no waiting, no email later.",
  },
  {
    number: "04",
    title: "Pick what happens next",
    body: "Speak a phrase out loud, pop a notification, message Slack or Discord, call any webhook, or send an email, whenever it spots your thing.",
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
            No code. No dataset to gather. No machine learning background needed. If you can take
            a few photos and describe what you want, you can build one of these.
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
