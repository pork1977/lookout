"use client";

import { useEffect, useRef, useState } from "react";
import type { CameraDevice } from "@/lib/useMediaDevices";

/**
 * Rendered in two places at once, above the inline camera and inside the
 * expanded overlay. Only `open` is local to each copy; every piece of state
 * that has to agree between them (which cameras are active, whether compare
 * mode is on) lives in the parent, so changing the camera in one place is
 * immediately reflected in the other.
 */
export default function CameraPicker({
  cameras,
  hasLabels,
  activeIds,
  maxActive,
  compareMode,
  onCompareModeChange,
  onSelectPrimary,
  onToggleGridMember,
  onCollapseToSingle,
}: {
  cameras: CameraDevice[];
  hasLabels: boolean;
  activeIds: string[];
  maxActive: number;
  compareMode: boolean;
  onCompareModeChange: (compare: boolean) => void;
  onSelectPrimary: (deviceId: string) => void;
  onToggleGridMember: (deviceId: string) => void;
  onCollapseToSingle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (!hasLabels) {
    // Browsers withhold device labels until camera permission has been granted
    // once, so there is nothing useful to pick from yet. Wording stays neutral
    // because this also renders inside the overlay, where "above" means nothing.
    return (
      <span className="text-xs text-muted">Start a camera to switch or add devices.</span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        {activeIds.length > 1 ? `${activeIds.length} cameras` : "Camera"}
        <span className="text-muted">{cameras.length} available</span>
      </button>

      {open && (
        <div className="absolute left-0 top-10 z-40 w-72 rounded-xl border border-border-strong bg-surface p-1.5 shadow-2xl">
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-muted">
            {compareMode
              ? `Select up to ${maxActive} cameras to view side by side.`
              : "Pick a camera, or compare more than one at once."}
          </p>

          {cameras.map((cam, i) => {
            const checked = activeIds.includes(cam.deviceId);
            const disabled = compareMode && !checked && activeIds.length >= maxActive;
            return (
              <button
                key={cam.deviceId}
                disabled={disabled}
                onClick={() =>
                  compareMode ? onToggleGridMember(cam.deviceId) : onSelectPrimary(cam.deviceId)
                }
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center border"
                  style={{
                    borderRadius: compareMode ? 4 : 999,
                    borderColor: checked ? "var(--accent)" : "var(--border-strong)",
                    background: checked ? "var(--accent)" : "transparent",
                  }}
                >
                  {checked && (
                    <svg
                      viewBox="0 0 12 12"
                      className="h-2.5 w-2.5"
                      fill="none"
                      stroke="var(--accent-ink)"
                      strokeWidth={2}
                    >
                      <path d="M2 6.5 4.8 9 10 3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{cam.label || `Camera ${i + 1}`}</span>
              </button>
            );
          })}

          <div className="mt-1 border-t border-border pt-1">
            <button
              onClick={() => {
                if (compareMode) {
                  onCompareModeChange(false);
                  onCollapseToSingle();
                } else {
                  onCompareModeChange(true);
                }
              }}
              className="w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-accent hover:bg-surface-raised"
            >
              {compareMode ? "Back to a single camera" : "Compare multiple cameras"}
            </button>
            {/* A warning rather than hiding the option: running two cameras at
                once is a per-device limit, not a blanket mobile one. iOS Safari
                effectively allows one at a time; plenty of Android hardware
                manages two. Hiding it would take the feature away from phones
                that can do it, so the honest move is to set expectations and
                let the failure path explain itself if it can't. */}
            <p className="px-2.5 pb-1 pt-0.5 text-[11px] leading-relaxed text-muted lg:hidden">
              Phones and tablets often allow only one camera at a time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
