"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DescribeStep from "./DescribeStep";
import ExamplesStep from "./ExamplesStep";
import ReviewStep from "./ReviewStep";
import TrainStep from "./TrainStep";
import TriggersStep from "./TriggersStep";
import { MAX_CLASSES, MIN_CLASSES, type DetectorClass, type ExampleImage } from "./types";
import { disposeHead, type TrainedHead } from "@/lib/trainer";
import type { Preset } from "@/lib/presets";

const STEPS = ["Describe", "Examples", "Review & label", "Train", "Triggers", "Deploy"] as const;

/** Built so far. The rest are laid out greyed so the shape of the flow is visible. */
const LIVE_STEPS = 5;

export default function BuildWizard() {
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState("");
  const [presetId, setPresetId] = useState<string | null>(null);
  // Fixed initial ids rather than generated ones: these render on the server
  // too, and a counter would disagree across the hydration boundary.
  const [classes, setClasses] = useState<DetectorClass[]>([
    { id: "class-a", name: "", examples: [] },
    { id: "class-b", name: "", examples: [] },
  ]);
  const [activeClassId, setActiveClassId] = useState("class-a");
  /**
   * The trained model lives here rather than in the training step, because the
   * triggers step needs it and navigating between the two unmounts one of them.
   */
  const [head, setHead] = useState<TrainedHead | null>(null);
  const headRef = useRef<TrainedHead | null>(null);
  const nextId = useRef(0);

  const adoptHead = useCallback((next: TrainedHead) => {
    // A retrain replaces the model; freeing the old one keeps its weights from
    // sitting on the GPU for the rest of the session.
    disposeHead(headRef.current);
    headRef.current = next;
    setHead(next);
  }, []);

  useEffect(() => () => disposeHead(headRef.current), []);

  const newId = useCallback((prefix: string) => {
    nextId.current += 1;
    return `${prefix}-${nextId.current}`;
  }, []);

  /**
   * Every object URL handed out, so unmount can release them all. Revoking
   * anywhere else per-render would blank thumbnails that are still on screen.
   */
  const urlsRef = useRef<Set<string>>(new Set());

  const trackUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urlsRef.current.add(url);
    return url;
  }, []);

  const releaseUrl = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    urlsRef.current.delete(url);
  }, []);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const pickPreset = useCallback(
    (preset: Preset) => {
      setPresetId(preset.id);
      setDescription(preset.description);
      // Renaming rather than replacing keeps class ids stable, so any photos
      // already captured stay where they are.
      setClasses((prev) =>
        prev.map((cls, i) => (i < preset.classes.length ? { ...cls, name: preset.classes[i] } : cls)),
      );
    },
    [],
  );

  const renameClass = useCallback((id: string, name: string) => {
    setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    setPresetId(null);
  }, []);

  const addClass = useCallback(() => {
    const id = newId("class");
    setClasses((prev) => (prev.length >= MAX_CLASSES ? prev : [...prev, { id, name: "", examples: [] }]));
  }, [newId]);

  const removeClass = useCallback(
    (id: string) => {
      setClasses((prev) => {
        if (prev.length <= MIN_CLASSES) return prev;
        const doomed = prev.find((c) => c.id === id);
        doomed?.examples.forEach((e) => releaseUrl(e.url));
        const next = prev.filter((c) => c.id !== id);
        setActiveClassId((current) => (current === id ? next[0].id : current));
        return next;
      });
    },
    [releaseUrl],
  );

  const addExamples = useCallback(
    (blobs: Blob[], source: ExampleImage["source"]) => {
      const created: ExampleImage[] = blobs.map((blob) => ({
        id: newId("ex"),
        url: trackUrl(blob),
        blob,
        source,
      }));
      setClasses((prev) =>
        prev.map((c) =>
          c.id === activeClassId ? { ...c, examples: [...c.examples, ...created] } : c,
        ),
      );
    },
    [activeClassId, newId, trackUrl],
  );

  const handleCapture = useCallback((blob: Blob) => addExamples([blob], "camera"), [addExamples]);
  const handleUpload = useCallback((blobs: Blob[]) => addExamples(blobs, "upload"), [addExamples]);

  const deleteExample = useCallback(
    (classId: string, exampleId: string) => {
      setClasses((prev) =>
        prev.map((c) => {
          if (c.id !== classId) return c;
          const doomed = c.examples.find((e) => e.id === exampleId);
          if (doomed) releaseUrl(doomed.url);
          return { ...c, examples: c.examples.filter((e) => e.id !== exampleId) };
        }),
      );
    },
    [releaseUrl],
  );

  const moveExample = useCallback((fromClassId: string, exampleId: string, toClassId: string) => {
    setClasses((prev) => {
      const from = prev.find((c) => c.id === fromClassId);
      const moving = from?.examples.find((e) => e.id === exampleId);
      if (!moving) return prev;
      // Deliberately no revoke: the same ExampleImage is changing buckets, and
      // its URL has to keep working in the bucket it lands in.
      return prev.map((c) => {
        if (c.id === fromClassId) {
          return { ...c, examples: c.examples.filter((e) => e.id !== exampleId) };
        }
        if (c.id === toClassId) return { ...c, examples: [...c.examples, moving] };
        return c;
      });
    });
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Build a detector</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Describe what you want it to catch, show it a handful of examples, and it trains itself
          right here in your browser.
        </p>
      </header>

      <ol className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {STEPS.map((name, i) => {
          const done = i < step;
          const current = i === step;
          const available = i < LIVE_STEPS;
          return (
            <li key={name} className="flex items-center gap-2">
              <span
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium"
                style={{
                  borderColor: current ? "var(--accent)" : "var(--border-strong)",
                  color: current ? "var(--accent)" : available ? "var(--foreground)" : "var(--muted)",
                  opacity: available ? 1 : 0.5,
                }}
              >
                <span className="font-mono text-[11px]">{done ? "✓" : i + 1}</span>
                {name}
              </span>
              {i < STEPS.length - 1 && <span className="text-muted">·</span>}
            </li>
          );
        })}
      </ol>

      {step === 0 ? (
        <DescribeStep
          description={description}
          onDescriptionChange={(value) => {
            setDescription(value);
            setPresetId(null);
          }}
          presetId={presetId}
          onPickPreset={pickPreset}
          classes={classes}
          onRenameClass={renameClass}
          onAddClass={addClass}
          onRemoveClass={removeClass}
          onContinue={() => setStep(1)}
        />
      ) : step === 1 ? (
        <ExamplesStep
          classes={classes}
          activeClassId={activeClassId}
          onSelectClass={setActiveClassId}
          onCapture={handleCapture}
          onUpload={handleUpload}
          onDeleteExample={deleteExample}
          onMoveExample={moveExample}
          onBack={() => setStep(0)}
          onContinue={() => setStep(2)}
        />
      ) : step === 2 ? (
        <ReviewStep
          description={description}
          classes={classes}
          onMoveExample={moveExample}
          onDeleteExample={deleteExample}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      ) : step === 3 ? (
        <TrainStep
          classes={classes}
          head={head}
          onTrained={adoptHead}
          onBack={() => setStep(2)}
          onContinue={() => setStep(4)}
        />
      ) : (
        <TriggersStep
          classes={classes}
          head={head}
          detectorName={description || "Lookout"}
          onBack={() => setStep(3)}
        />
      )}

      {/* Persistence is Phase G. Saying so here beats letting someone lose
          forty photos to a refresh and assume it's a bug. */}
      <p className="mt-12 border-t border-border pt-6 text-xs text-muted">
        Work in progress: this draft lives in this browser tab only, so a refresh clears it.
        Accounts and saved detectors come later in the build.
      </p>
    </div>
  );
}
