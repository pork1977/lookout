"use client";

import { useEffect, useRef, useState } from "react";
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
  onContinue,
}: {
  classes: DetectorClass[];
  activeClassId: string;
  onSelectClass: (id: string) => void;
  onCapture: (blob: Blob) => void;
  onUpload: (blobs: Blob[]) => void;
  onDeleteExample: (classId: string, exampleId: string) => void;
  onMoveExample: (fromClassId: string, exampleId: string, toClassId: string) => void;
  onBack: () => void;
  onContinue: () => void;
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
              onClick={onContinue}
              disabled={short.length > 0}
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
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
                {short.map((c) => `"${c.name || "Untitled group"}"`).join(" and ")} still
                {short.length === 1 ? " needs" : " need"} at least {MIN_PER_CLASS} photos before
                the next step is worth running.
              </>
            ) : (
              <>
                Next, Claude looks at each photo and says which group it belongs in, so you only
                review the ones it isn&apos;t sure about.
              </>
            )}
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
                  ? `${count} photos. ${RECOMMENDED_PER_CLASS} makes it noticeably steadier`
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

      {/* 72px cells couldn't fit "Move to…" plus a native select arrow, so the
          label clipped. The overlay controls set the floor here, not the
          thumbnail. */}
      {count > 0 && (
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    // No overflow clipping here: the move menu has to be able to hang below the
    // thumbnail. The image rounds its own corners instead.
    <li className="group relative aspect-square">
      {/* A plain <img>: these are object URLs for in-memory blobs, which the
          Next image pipeline can neither optimise nor size ahead of time. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={example.url}
        alt=""
        className="absolute inset-0 h-full w-full rounded-lg border border-border object-cover"
      />

      <div
        className={`absolute inset-0 flex flex-col items-stretch justify-center gap-1.5 rounded-lg bg-background/80 p-2 backdrop-blur-sm transition-opacity ${
          // Pinned open while the menu is: moving the pointer onto the menu
          // leaves the thumbnail, and a hover-only rule would hide the controls
          // out from under it.
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
        }`}
      >
        <button
          onClick={onDelete}
          className="w-full rounded-full bg-surface px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-surface-raised"
        >
          Delete
        </button>

        {/* With the usual two groups there's only one destination, so a plain
            button beats any kind of menu. */}
        {otherClasses.length === 1 ? (
          <button
            onClick={() => onMove(otherClasses[0].id)}
            title={`Move to "${otherClasses[0].name || "Untitled group"}"`}
            className="w-full truncate rounded-full bg-surface px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-surface-raised"
          >
            Move
          </button>
        ) : otherClasses.length > 1 ? (
          <MoveMenu
            otherClasses={otherClasses}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onMove={(id) => {
              setMenuOpen(false);
              onMove(id);
            }}
          />
        ) : null}
      </div>
    </li>
  );
}

/**
 * Replaces a native <select>.
 *
 * The browser draws an option list as its own widget, outside the DOM, its
 * padding can't be set reliably and its layout can't even be measured, so
 * "give the text room on the right" isn't something CSS can promise there.
 * This is the same button-plus-panel pattern the camera picker uses, which
 * means every edge is ours to space properly.
 */
function MoveMenu({
  otherClasses,
  open,
  onOpenChange,
  onMove,
}: {
  otherClasses: DetectorClass[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (toClassId: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onOpenChange(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-1.5 rounded-full bg-surface py-1.5 pl-3 pr-2.5 text-[11px] font-medium text-foreground hover:bg-surface-raised"
      >
        <span className="truncate">Move to…</span>
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1.5 min-w-full rounded-xl border border-border-strong bg-surface p-1 shadow-2xl"
        >
          {otherClasses.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              onClick={() => onMove(c.id)}
              className="block w-full max-w-[220px] truncate rounded-lg py-2 pl-3 pr-5 text-left text-[11px] text-foreground transition-colors hover:bg-surface-raised"
            >
              {c.name || "Untitled group"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
