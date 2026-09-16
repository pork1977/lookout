"use client";

import CapturePanel from "./CapturePanel";
import {
  MIN_PER_CLASS,
  RECOMMENDED_PER_CLASS,
  type DetectorClass,
  type ExampleImage,
} from "./types";

export default function ExamplesStep({
  classes,
  activeClassId,
  onSelectClass,
  onCapture,
  onUpload,
  onDeleteExample,
  onMoveExample,
  onBack,
}: {
  classes: DetectorClass[];
  activeClassId: string;
  onSelectClass: (id: string) => void;
  onCapture: (blob: Blob) => void;
  onUpload: (blobs: Blob[]) => void;
  onDeleteExample: (classId: string, exampleId: string) => void;
  onMoveExample: (fromClassId: string, exampleId: string, toClassId: string) => void;
  onBack: () => void;
}) {
  const active = classes.find((c) => c.id === activeClassId) ?? classes[0];
  const short = classes.filter((c) => c.examples.length < MIN_PER_CLASS);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4 lg:sticky lg:top-24">
        <div className="flex flex-wrap gap-2">
          {classes.map((cls) => {
            const selected = cls.id === active.id;
            return (
              <button
                key={cls.id}
                onClick={() => onSelectClass(cls.id)}
                aria-pressed={selected}
                className="flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: selected ? "var(--accent)" : "var(--border-strong)",
                  background: selected ? "var(--surface-raised)" : "transparent",
                  color: selected ? "var(--accent)" : "var(--foreground)",
                }}
              >
                {cls.name || "Untitled group"}
                <span className="font-mono text-[11px] text-muted">{cls.examples.length}</span>
              </button>
            );
          })}
        </div>

        <CapturePanel
          targetName={active.name || "Untitled group"}
          onCapture={onCapture}
          onUpload={onUpload}
        />
      </div>

      <div className="space-y-5">
        {classes.map((cls) => (
          <ClassBucket
            key={cls.id}
            cls={cls}
            otherClasses={classes.filter((c) => c.id !== cls.id)}
            isActive={cls.id === active.id}
            onSelect={() => onSelectClass(cls.id)}
            onDeleteExample={(exampleId) => onDeleteExample(cls.id, exampleId)}
            onMoveExample={(exampleId, toClassId) => onMoveExample(cls.id, exampleId, toClassId)}
          />
        ))}

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={onBack}
              className="rounded-full border border-border-strong px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              Back
            </button>
            <button
              disabled
              className="cursor-not-allowed rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink opacity-40"
              style={{
                backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
              }}
            >
              Review &amp; label
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {short.length > 0 ? (
              <>
                Needs at least {MIN_PER_CLASS} photos in{" "}
                {short.map((c) => `"${c.name || "Untitled group"}"`).join(", ")}.{" "}
              </>
            ) : (
              <>Enough to train on. </>
            )}
            The review and labelling step is the next thing being built — this button turns on with
            it.
          </p>
        </div>
      </div>
    </div>
  );
}

function ClassBucket({
  cls,
  otherClasses,
  isActive,
  onSelect,
  onDeleteExample,
  onMoveExample,
}: {
  cls: DetectorClass;
  otherClasses: DetectorClass[];
  isActive: boolean;
  onSelect: () => void;
  onDeleteExample: (exampleId: string) => void;
  onMoveExample: (exampleId: string, toClassId: string) => void;
}) {
  const count = cls.examples.length;
  const progress = Math.min(1, count / RECOMMENDED_PER_CLASS);

  return (
    <section
      className="rounded-2xl border bg-surface p-5 transition-colors"
      style={{ borderColor: isActive ? "var(--accent)" : "var(--border)" }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {cls.name || "Untitled group"}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {count === 0
              ? "No photos yet"
              : count < MIN_PER_CLASS
                ? `${count} of ${MIN_PER_CLASS} minimum`
                : count < RECOMMENDED_PER_CLASS
                  ? `${count} photos — ${RECOMMENDED_PER_CLASS} makes it noticeably steadier`
                  : `${count} photos`}
          </p>
        </div>
        {!isActive && (
          <button
            onClick={onSelect}
            className="shrink-0 rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            Capture into this
          </button>
        )}
      </header>

      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-raised">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${progress * 100}%`,
            background: "linear-gradient(90deg, var(--accent), var(--accent-strong))",
          }}
        />
      </div>

      {count > 0 && (
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
          {cls.examples.map((example) => (
            <Thumbnail
              key={example.id}
              example={example}
              otherClasses={otherClasses}
              onDelete={() => onDeleteExample(example.id)}
              onMove={(toClassId) => onMoveExample(example.id, toClassId)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function Thumbnail({
  example,
  otherClasses,
  onDelete,
  onMove,
}: {
  example: ExampleImage;
  otherClasses: DetectorClass[];
  onDelete: () => void;
  onMove: (toClassId: string) => void;
}) {
  return (
    <li className="group relative aspect-square overflow-hidden rounded-lg border border-border">
      {/* A plain <img>: these are object URLs for in-memory blobs, which the
          Next image pipeline can neither optimise nor size ahead of time. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={example.url} alt="" className="h-full w-full object-cover" />

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          onClick={onDelete}
          className="rounded-full bg-surface px-2 py-1 text-[10px] font-medium text-foreground hover:bg-surface-raised"
        >
          Delete
        </button>
        {otherClasses.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value && onMove(e.target.value)}
            aria-label="Move to another group"
            className="max-w-[90%] rounded-full bg-surface px-2 py-1 text-[10px] text-foreground outline-none"
          >
            <option value="">Move to…</option>
            {otherClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || "Untitled group"}
              </option>
            ))}
          </select>
        )}
      </div>
    </li>
  );
}
