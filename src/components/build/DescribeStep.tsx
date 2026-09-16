"use client";

import { PRESET_CATEGORIES, type Preset } from "@/lib/presets";
import { MAX_CLASSES, MIN_CLASSES, type DetectorClass } from "./types";

export default function DescribeStep({
  description,
  onDescriptionChange,
  presetId,
  onPickPreset,
  classes,
  onRenameClass,
  onAddClass,
  onRemoveClass,
  onContinue,
}: {
  description: string;
  onDescriptionChange: (value: string) => void;
  presetId: string | null;
  onPickPreset: (preset: Preset) => void;
  classes: DetectorClass[];
  onRenameClass: (id: string, name: string) => void;
  onAddClass: () => void;
  onRemoveClass: (id: string) => void;
  onContinue: () => void;
}) {
  const blankName = classes.find((c) => !c.name.trim());
  const blocker = !description.trim()
    ? "Describe what it should notice to continue"
    : blankName
      ? "Give every group a name to continue"
      : null;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="space-y-10">
        <section>
          <label htmlFor="detector-description" className="text-sm font-semibold text-foreground">
            What should it notice?
          </label>
          <p className="mt-1.5 text-sm text-muted">
            Plain English. This is for you and for the labelling step later, not code.
          </p>
          <textarea
            id="detector-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
            placeholder="Notice when my coffee mug is empty"
            className="mt-4 w-full resize-y rounded-2xl border border-border-strong bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground">Or start from an idea</h2>
          <p className="mt-1.5 text-sm text-muted">
            Each one fills in the description and a sensible pair of groups. You can edit both.
          </p>

          <div className="mt-5 space-y-6">
            {PRESET_CATEGORIES.map((category) => (
              <div key={category.name}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">
                  {category.name}
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {category.presets.map((preset) => {
                    const selected = preset.id === presetId;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => onPickPreset(preset)}
                        aria-pressed={selected}
                        className="rounded-full border px-4 py-2 text-sm transition-colors"
                        style={{
                          borderColor: selected ? "var(--accent)" : "var(--border-strong)",
                          background: selected ? "var(--surface-raised)" : "transparent",
                          color: selected ? "var(--accent)" : "var(--foreground)",
                        }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="rounded-2xl border border-border bg-surface p-6 lg:sticky lg:top-24">
        <h2 className="text-sm font-semibold text-foreground">Groups you&apos;ll photograph next</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          A detector only learns by comparison, so it needs photos of the thing you want caught{" "}
          <em>and</em> photos of everything being normal. On the next step you&apos;ll fill each of
          these with examples.
        </p>

        <div className="mt-5 space-y-2">
          {classes.map((cls, i) => (
            <div key={cls.id} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{i + 1}</span>
              <input
                value={cls.name}
                onChange={(e) => onRenameClass(cls.id, e.target.value)}
                aria-label={`Name for group ${i + 1}`}
                // Positional placeholders do the explaining: a generic "name this
                // group" left people working out what the section was for only
                // once they reached the capture step.
                placeholder={
                  i === 0
                    ? "The thing to catch"
                    : i === 1
                      ? "What normal looks like"
                      : "Another thing to catch"
                }
                className="min-w-0 flex-1 rounded-xl border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent"
              />
              <button
                onClick={() => onRemoveClass(cls.id)}
                disabled={classes.length <= MIN_CLASSES}
                aria-label={`Remove group ${i + 1}`}
                title={
                  classes.length <= MIN_CLASSES
                    ? `A detector needs at least ${MIN_CLASSES} groups`
                    : undefined
                }
                className="shrink-0 rounded-lg px-2 py-1 text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={onAddClass}
          disabled={classes.length >= MAX_CLASSES}
          className="mt-3 rounded-full border border-border-strong px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add another group
        </button>
        {/* Kept away from the explanation above: "two is usually right" sitting
            next to "a detector needs both" read as two rules contradicting each
            other rather than one rule and one hint. */}
        <p className="mt-2 text-xs text-muted">Most detectors only need two.</p>

        <div className="mt-6 border-t border-border pt-5">
          <button
            onClick={onContinue}
            disabled={!!blocker}
            className="w-full rounded-full px-5 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
            }}
          >
            Continue to examples
          </button>
          {/* A disabled button with no explanation is its own bug. */}
          {blocker && <p className="mt-2 text-center text-xs text-muted">{blocker}</p>}
        </div>
      </aside>
    </div>
  );
}
