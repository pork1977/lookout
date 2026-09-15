const categories = [
  {
    name: "About you",
    examples: [
      "Notice when I bring a drink to my desk",
      "Notice when I've been slouching",
      "Notice when I'm on my phone instead of working",
      "Notice when I put my headphones on",
    ],
  },
  {
    name: "Home",
    examples: [
      "Notice when someone walks into the room behind me",
      "Notice when the dog jumps on the couch",
      "Notice when a delivery shows up at the door",
    ],
  },
  {
    name: "Office & focus",
    examples: [
      "Notice when someone walks up behind me",
      "Notice when I've left my desk for a while",
      "Notice when my coffee mug is empty",
    ],
  },
  {
    name: "Whatever you want",
    examples: [
      "Start from a blank page and describe your own",
      "Any object, gesture, or moment you can photograph",
    ],
  },
];

export default function PresetIdeas() {
  return (
    <section className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Don&apos;t know what to build? Start here
          </h2>
          <p className="mt-4 text-muted">
            A few ready-made ideas to get you going, or write your own from scratch.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((category) => (
            <div
              key={category.name}
              className="rounded-2xl border border-border bg-surface p-6 transition-all hover:border-border-strong hover:shadow-[0_20px_60px_-30px_var(--glow)]"
            >
              <h3 className="text-sm font-semibold text-accent">{category.name}</h3>
              <ul className="mt-4 space-y-3">
                {category.examples.map((example) => (
                  <li key={example} className="text-sm leading-relaxed text-muted">
                    {example}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
