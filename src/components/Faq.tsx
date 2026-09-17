export const faqs = [
  {
    question: "Is Lookout free to use?",
    answer:
      "Training and detection run in your browser and don't cost anything. AI-assisted labelling and email triggers depend on keys the site owner configures, and are disabled with a clear note if they aren't set up.",
  },
  {
    question: "Do I need to write code or collect a dataset?",
    answer:
      "No. You describe what to notice in plain English and add a handful of example photos from your webcam or your files. Lookout trains a small model on them in the page.",
  },
  {
    question: "Do my photos get uploaded anywhere?",
    answer:
      "Training happens on your device and your photos aren't sent to a server for it. They're only uploaded if you turn on AI-assisted labelling for a photo, or create an account to back your detector up.",
  },
  {
    question: "Do I need an account?",
    answer:
      "No. Detectors are saved in your browser as you work. An account is only needed if you want to back a detector up and restore it on another machine.",
  },
  {
    question: "What can a detector do when it sees what it's trained for?",
    answer:
      "It can speak a phrase, show an on-screen banner, raise a browser notification, message Slack or Discord, call a webhook, or send an email.",
  },
  {
    question: "Can I use a detector outside Lookout?",
    answer:
      "Yes. The export option gives you a zip with the trained model, the training photos, and a plain index.html that runs the detector on its own, so it can be used in your own project.",
  },
];

export default function Faq() {
  return (
    <section id="faq" className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Frequently asked questions
          </h2>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          {faqs.map((faq) => (
            <div
              key={faq.question}
              className="rounded-2xl border border-border bg-surface p-6"
            >
              <h3 className="font-semibold text-foreground">{faq.question}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
