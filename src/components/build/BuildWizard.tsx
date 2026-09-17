"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DescribeStep from "./DescribeStep";
import ExamplesStep from "./ExamplesStep";
import ReviewStep from "./ReviewStep";
import TrainStep from "./TrainStep";
import TriggersStep from "./TriggersStep";
import DeployStep from "./DeployStep";
import { MAX_CLASSES, MIN_CLASSES, type DetectorClass, type ExampleImage } from "./types";
import AccountPanel from "./AccountPanel";
import DetectorLibrary from "./DetectorLibrary";
import { disposeHead, loadHead, saveHead, type TrainedHead } from "@/lib/trainer";
import * as store from "@/lib/detectorStore";
import type { Preset } from "@/lib/presets";
import {
  defaultTriggerSettings,
  sanitizeTriggerSettings,
  type TriggerSettings,
} from "@/lib/triggerSettings";

const STEPS = ["Describe", "Examples", "Review & label", "Train", "Triggers", "Deploy & export"] as const;

const LIVE_STEPS = STEPS.length;

/** Which detector to reopen on the next visit. */
const LAST_OPEN_KEY = "lookout.lastDetectorId";

/** Metadata is written this long after the last edit, so typing isn't one write per keystroke. */
const SAVE_DEBOUNCE_MS = 600;

const BLANK_CLASSES = (): DetectorClass[] => [
  { id: "class-a", name: "", examples: [] },
  { id: "class-b", name: "", examples: [] },
];

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
  const [detectorId, setDetectorId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [triggerSettings, setTriggerSettings] = useState<TriggerSettings>(() =>
    defaultTriggerSettings("class-a"),
  );
  /**
   * The trained model lives here rather than in the training step, because the
   * triggers step needs it and navigating between the two unmounts one of them.
   */
  const [head, setHead] = useState<TrainedHead | null>(null);
  const headRef = useRef<TrainedHead | null>(null);
  const nextId = useRef(0);

  const setActiveHead = useCallback((next: TrainedHead | null) => {
    // A retrain replaces the model; freeing the old one keeps its weights from
    // sitting on the GPU for the rest of the session.
    if (headRef.current !== next) disposeHead(headRef.current);
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

  /**
   * Photos are written one record at a time as they arrive, and metadata is
   * debounced. Rewriting every blob on each keystroke would be the obvious
   * shape and the wrong one, the photos never change after capture.
   */
  const saveTimerRef = useRef<number | null>(null);
  const stateRef = useRef({ description, presetId, classes, detectorId, triggerSettings });
  useEffect(() => {
    stateRef.current = { description, presetId, classes, detectorId, triggerSettings };
  });

  const persistMeta = useCallback(async () => {
    const {
      description: name,
      presetId: preset,
      classes: cls,
      detectorId: id,
      triggerSettings: triggers,
    } = stateRef.current;
    if (!id) return;
    const existing = await store.getDetector(id);
    await store.saveDetector({
      id,
      name,
      presetId: preset,
      classes: cls.map((c) => ({ id: c.id, name: c.name })),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      exampleCount: cls.reduce((n, c) => n + c.examples.length, 0),
      hasModel: existing?.hasModel ?? false,
      modelClassIds: existing?.modelClassIds,
      modelAccuracy: existing?.modelAccuracy,
      triggers,
    });
    setSavedAt(Date.now());
  }, []);

  /**
   * Keeps a freshly trained model, and saves it beside the photos so a refresh
   * or reopening the detector doesn't cost another training run. Saving is
   * best effort: if it fails the model still works for this session.
   */
  const adoptHead = useCallback(
    (next: TrainedHead) => {
      setActiveHead(next);
      const id = stateRef.current.detectorId;
      if (!id) return;
      void (async () => {
        await saveHead(next, store.modelUrl(id));
        await persistMeta();
        const record = await store.getDetector(id);
        if (!record) return;
        await store.saveDetector({
          ...record,
          hasModel: true,
          modelClassIds: next.classIds,
          modelAccuracy: next.finalAccuracy,
        });
        setSavedAt(Date.now());
      })().catch(() => {
        /* storage full or blocked; the model still works until the tab closes */
      });
    },
    [setActiveHead, persistMeta],
  );

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void persistMeta(), SAVE_DEBOUNCE_MS);
  }, [persistMeta]);

  const pickPreset = useCallback(
    (preset: Preset) => {
      setPresetId(preset.id);
      setDescription(preset.description);
      // Renaming rather than replacing keeps class ids stable, so any photos
      // already captured stay where they are.
      setClasses((prev) =>
        prev.map((cls, i) => (i < preset.classes.length ? { ...cls, name: preset.classes[i] } : cls)),
      );
      scheduleSave();
    },
    [scheduleSave],
  );

  const renameClass = useCallback(
    (id: string, name: string) => {
      setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
      setPresetId(null);
      scheduleSave();
    },
    [scheduleSave],
  );

  const addClass = useCallback(() => {
    const id = newId("class");
    setClasses((prev) => (prev.length >= MAX_CLASSES ? prev : [...prev, { id, name: "", examples: [] }]));
    scheduleSave();
  }, [newId, scheduleSave]);

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
      const owner = stateRef.current.detectorId;
      if (owner) void store.deleteExamplesForClass(owner, id).then(persistMeta);
    },
    [releaseUrl, persistMeta],
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

      const owner = stateRef.current.detectorId;
      if (owner) {
        void Promise.all(
          created.map((example) =>
            store.putExample({
              id: example.id,
              detectorId: owner,
              classId: activeClassId,
              blob: example.blob,
              source: example.source,
              createdAt: Date.now(),
            }),
          ),
        ).then(persistMeta);
      }
    },
    [activeClassId, newId, trackUrl, persistMeta],
  );

  const updateTriggerSettings = useCallback(
    (update: (previous: TriggerSettings) => TriggerSettings) => {
      setTriggerSettings(update);
      scheduleSave();
    },
    [scheduleSave],
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
      void store.deleteExample(exampleId).then(persistMeta);
    },
    [releaseUrl, persistMeta],
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
    void store.moveExample(exampleId, toClassId);
  }, []);

  const loadDetector = useCallback(
    async (id: string) => {
      // Everything on screen belongs to the detector being closed: its object
      // URLs, and a trained model that no longer matches the incoming classes.
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
      setActiveHead(null);

      const record = await store.getDetector(id);
      if (!record) return;
      const examples = await store.listExamples(id);

      setDetectorId(id);
      window.localStorage.setItem(LAST_OPEN_KEY, id);
      setDescription(record.name);
      setPresetId(record.presetId);
      setClasses(
        record.classes.map((cls) => ({
          id: cls.id,
          name: cls.name,
          examples: examples
            .filter((e) => e.classId === cls.id)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((e) => ({ id: e.id, url: trackUrl(e.blob), blob: e.blob, source: e.source })),
        })),
      );
      setActiveClassId(record.classes[0]?.id ?? "class-a");
      setTriggerSettings(
        sanitizeTriggerSettings(
          record.triggers,
          record.classes.map((c) => c.id),
        ),
      );
      setStep(0);
      setSavedAt(Date.now());

      // Bring the trained model back too, but only if it was trained on exactly
      // these groups. A model from before a group was added would score the
      // wrong list.
      const ids = record.classes.map((c) => c.id);
      const matches =
        record.hasModel &&
        record.modelClassIds?.length === ids.length &&
        record.modelClassIds.every((cid, i) => cid === ids[i]);
      if (matches) {
        try {
          const restored = await loadHead(store.modelUrl(id), ids, record.modelAccuracy ?? 0);
          // Another detector may have been opened while this one loaded.
          if (stateRef.current.detectorId === id) setActiveHead(restored);
          else disposeHead(restored);
        } catch {
          /* saved model missing or unreadable; training again fixes it */
        }
      }
    },
    [trackUrl, setActiveHead],
  );

  const createDetector = useCallback(() => {
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current.clear();
    setActiveHead(null);

    const id = `det-${Date.now().toString(36)}`;
    setDetectorId(id);
    window.localStorage.setItem(LAST_OPEN_KEY, id);
    setDescription("");
    setPresetId(null);
    setClasses(BLANK_CLASSES());
    setActiveClassId("class-a");
    setTriggerSettings(defaultTriggerSettings("class-a"));
    setStep(0);
    setSavedAt(Date.now());
  }, [setActiveHead]);

  /**
   * On first paint: reopen the detector that was last open, or mint a new id.
   *
   * `loadDetector` and `createDetector` only close over stable callbacks and
   * setters, so their identities never change and this runs exactly once.
   */
  useEffect(() => {
    if (!store.storageSupported()) {
      // Only reachable in a browser with IndexedDB disabled, and there is no
      // value to read for this during SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageBlocked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const lastId = window.localStorage.getItem(LAST_OPEN_KEY);
      const existing = lastId ? await store.getDetector(lastId) : undefined;
      if (cancelled) return;
      if (existing) await loadDetector(existing.id);
      else createDetector();
    })().catch(() => {
      /* a failed reopen just leaves the blank draft in place */
    });
    return () => {
      cancelled = true;
    };
  }, [loadDetector, createDetector]);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Build a detector</h1>
          <p className="mt-3 max-w-2xl text-muted">
            Describe what you want it to catch, show it a handful of examples, and it trains itself
            right here in your browser.
          </p>
        </div>
        {/* relative: below lg this row wraps under the title, so the two panels anchor
            to the row instead of their own buttons and stay on screen. */}
        <div className="relative flex items-center gap-2">
          <AccountPanel
            currentDetectorId={detectorId}
            onRestored={(id) => void loadDetector(id)}
          />
          <DetectorLibrary
            currentId={detectorId}
            currentName={description || "Untitled detector"}
            savedAt={savedAt}
            onOpen={(id) => void loadDetector(id)}
            onCreate={createDetector}
          />
        </div>
      </header>

      <ol className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
        {STEPS.map((name, i) => {
          const done = i < step;
          const current = i === step;
          const available = i < LIVE_STEPS;
          return (
            <li key={name} className="flex items-center gap-2">
              {/* Jumping straight to a step is allowed even when it can't do
                  anything yet, every step already explains what it's waiting
                  for, which is more useful than a control that ignores a click. */}
              <button
                onClick={() => setStep(i)}
                disabled={!available}
                aria-current={current ? "step" : undefined}
                title={available ? `Go to ${name}` : `${name} isn't built yet`}
                className="flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium transition-colors enabled:hover:bg-surface-raised disabled:cursor-not-allowed"
                style={{
                  borderColor: current ? "var(--accent)" : "var(--border-strong)",
                  color: current ? "var(--accent)" : available ? "var(--foreground)" : "var(--muted)",
                  opacity: available ? 1 : 0.5,
                }}
              >
                <span className="font-mono text-[11px]">{done ? "✓" : i + 1}</span>
                {name}
              </button>
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
            scheduleSave();
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
      ) : step === 4 ? (
        <TriggersStep
          classes={classes}
          head={head}
          detectorName={description || "Lookout"}
          settings={triggerSettings}
          onSettingsChange={updateTriggerSettings}
          onBack={() => setStep(3)}
          onContinue={() => setStep(5)}
        />
      ) : (
        <DeployStep
          detectorId={detectorId}
          detectorName={description}
          classes={classes}
          head={head}
          settings={triggerSettings}
          onBack={() => setStep(4)}
        />
      )}

      {/* The base sentence is identical on the server and in the browser on
          purpose. Branching on indexedDB here rendered different text in each
          and broke hydration, the warning is added after mount instead. */}
      <div className="mt-12 space-y-1 border-t border-border pt-6 text-xs text-muted">
        <p>
          Saved in this browser as you go, so a refresh keeps your photos. An account is optional
          and only adds backup across machines.
        </p>
        {storageBlocked && (
          <p className="text-foreground">
            This browser is blocking local storage, so this draft will be lost on refresh.
          </p>
        )}
      </div>
    </div>
  );
}
