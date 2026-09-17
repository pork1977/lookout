"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteDetector,
  estimateUsage,
  formatBytes,
  listDetectors,
  type DetectorRecord,
  type StorageUsage,
} from "@/lib/detectorStore";

export default function DetectorLibrary({
  currentId,
  currentName,
  savedAt,
  onOpen,
  onCreate,
}: {
  currentId: string | null;
  currentName: string;
  /** Bumped on every save, so the list and the "saved" note stay current. */
  savedAt: number;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detectors, setDetectors] = useState<DetectorRecord[]>([]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    listDetectors().then(setDetectors).catch(() => setDetectors([]));
    estimateUsage().then(setUsage).catch(() => setUsage(null));
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, savedAt, refresh]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setConfirmingId(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="lg:relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M2 4.5h12M2 8h12M2 11.5h12" strokeLinecap="round" />
        </svg>
        My detectors
        {detectors.length > 0 && <span className="font-mono text-muted">{detectors.length}</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-40 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-border-strong bg-surface p-2 shadow-2xl lg:left-auto lg:right-0">
          <div className="max-h-80 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
            {detectors.length === 0 && (
              <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted">
                Nothing is saved in this browser yet. Detectors are saved automatically as you build them.
                <br />
                Used another machine? Sign in under Account to bring a backup over.
              </p>
            )}

            {detectors.map((detector) => {
              const isCurrent = detector.id === currentId;
              const confirming = confirmingId === detector.id;
              return (
                <div
                  key={detector.id}
                  className="rounded-xl border border-transparent px-1 py-0.5 transition-colors hover:border-border"
                  style={{ background: isCurrent ? "var(--surface-raised)" : undefined }}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!isCurrent) onOpen(detector.id);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left"
                    >
                      <span className="block truncate text-sm text-foreground">
                        {detector.name || "Untitled detector"}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {detector.exampleCount} photo{detector.exampleCount === 1 ? "" : "s"} ·{" "}
                        {detector.classes.length} groups
                        {detector.hasModel && <span className="text-accent"> · trained</span>}
                        {isCurrent && " · open"}
                      </span>
                    </button>
                    <button
                      onClick={() => setConfirmingId(confirming ? null : detector.id)}
                      aria-label={`Delete ${detector.name || "detector"}`}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                    >
                      ×
                    </button>
                  </div>

                  {/* Deleting takes photos the user spent real time capturing,
                      so it asks, inline, rather than a dialog that steals focus. */}
                  {confirming && (
                    <div className="flex items-center justify-between gap-2 px-2 pb-2">
                      <span className="text-[11px] text-muted">Delete this and its photos?</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setConfirmingId(null)}
                          className="rounded-full border border-border-strong px-2.5 py-1 text-[11px] text-foreground hover:bg-surface-raised"
                        >
                          Keep
                        </button>
                        <button
                          onClick={async () => {
                            await deleteDetector(detector.id);
                            setConfirmingId(null);
                            refresh();
                            if (detector.id === currentId) onCreate();
                          }}
                          className="rounded-full border border-border-strong px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-surface-raised"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-1 space-y-1 border-t border-border pt-2">
            <button
              onClick={() => {
                onCreate();
                setOpen(false);
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-accent hover:bg-surface-raised"
            >
              Start a new detector
            </button>
            {usage && (
              <p className="px-3 pb-1 text-[11px] text-muted">
                Using {formatBytes(usage.usedBytes)} of this browser&apos;s{" "}
                {formatBytes(usage.quotaBytes)} allowance.
              </p>
            )}
          </div>
        </div>
      )}

      <span className="sr-only">Current detector: {currentName}</span>
    </div>
  );
}
