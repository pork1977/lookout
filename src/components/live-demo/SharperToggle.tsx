"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  detectorEngineSnapshot,
  setDetectorEngine,
  subscribeDetectorEngine,
} from "@/lib/detectorModel";

const PREFERENCE_KEY = "lookout.sharperDetection";

export function useDetectorEngine() {
  const snapshot = useSyncExternalStore(
    subscribeDetectorEngine,
    detectorEngineSnapshot,
    () => "standard:off" as const,
  );
  const [engine, status] = snapshot.split(":") as ["standard" | "sharp", string];
  return { engine, status };
}

/**
 * Rendered in the inline controls and in the expanded view at once; both read
 * the same module-level engine state, so they can never disagree.
 */
export default function SharperToggle({ showHint }: { showHint?: boolean }) {
  const { engine, status } = useDetectorEngine();
  const on = engine === "sharp";

  useEffect(() => {
    // Remembered per browser. Restoring it only ever turns it on, and only
    // after mount, so the server render and first paint always agree.
    try {
      if (window.localStorage.getItem(PREFERENCE_KEY) === "1") setDetectorEngine("sharp");
    } catch {
      /* storage blocked; start on standard */
    }
  }, []);

  const toggle = useCallback(() => {
    const next = on ? "standard" : "sharp";
    setDetectorEngine(next);
    try {
      window.localStorage.setItem(PREFERENCE_KEY, next === "sharp" ? "1" : "0");
    } catch {
      /* not remembered, still works */
    }
  }, [on]);

  const note =
    status === "loading"
      ? "Downloading…"
      : status === "failed"
        ? "Couldn't load here, using standard"
        : null;

  return (
    <div className="flex items-center gap-2">
      <button
        role="switch"
        aria-checked={on}
        onClick={toggle}
        title="Swaps in Google's MediaPipe detector, which is better at small and distant objects. About 7MB, downloaded the first time you switch it on."
        className="flex items-center gap-2 rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
      >
        <span
          className="relative h-3.5 w-6 shrink-0 rounded-full transition-colors"
          style={{ background: on ? "var(--accent)" : "var(--surface-raised)", boxShadow: "inset 0 0 0 1px var(--border-strong)" }}
        >
          <span
            className="absolute top-0.5 h-2.5 w-2.5 rounded-full transition-[left] duration-150"
            style={{ left: on ? 12 : 2, background: on ? "var(--accent-ink)" : "var(--muted)" }}
          />
        </span>
        Sharper detection
      </button>
      {note ? (
        <span className={`text-[11px] text-muted ${status === "loading" ? "animate-scan-pulse" : ""}`}>
          {note}
        </span>
      ) : (
        showHint && (
          <span className="hidden text-[11px] text-muted xl:inline">
            Better at small and faraway things.
          </span>
        )
      )}
    </div>
  );
}
