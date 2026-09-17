import Link from "next/link";
import { PRESET_CATEGORIES } from "@/lib/presets";

export default function PresetIdeas() {
  return (
    <section className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Don&apos;t know what to build? Start here
          </h2>
          <p className="mt-4 text-muted">
            Pick one of these to open the builder with the description and photo groups filled
            in, or write your own.
          </p>
        </div>

        {/* Same source the builder's own gallery reads, so the two can't drift. */}
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PRESET_CATEGORIES.map((category) => (
            <div
              key={category.name}
              className="rounded-2xl border border-border bg-surface p-6 transition-all hover:border-border-strong hover:shadow-[0_20px_60px_-30px_var(--glow)]"
            >
              <h3 className="text-sm font-semibold text-accent">{category.name}</h3>
              <ul className="mt-4 space-y-3">
                {category.presets.map((preset) => (
                  <li key={preset.id} className="text-sm leading-relaxed text-muted">
                    {preset.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <Link
            href="/build"
            className="rounded-full px-6 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02]"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
            }}
          >
            Build one of these
          </Link>
        </div>
      </div>
    </section>
  );
}
