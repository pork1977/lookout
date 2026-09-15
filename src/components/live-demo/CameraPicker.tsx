"use client";

import { useEffect, useRef, useState } from "react";
import type { CameraDevice } from "@/lib/useMediaDevices";

export default function CameraPicker({
  cameras,
  hasLabels,
  activeIds,
  maxActive,
  onSelectPrimary,
  onToggleGridMember,
  onCollapseToSingle,
}: {
  cameras: CameraDevice[];
  hasLabels: boolean;
  activeIds: string[];
  maxActive: number;
  onSelectPrimary: (deviceId: string) => void;
  onToggleGridMember: (deviceId: string) => void;
  onCollapseToSingle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [manualCompare, setManualCompare] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const compareMode = manualCompare || activeIds.length > 1;

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (!hasLabels) {
    return (
      <span className="text-xs text-muted">
        Start a camera above, then switch devices or add more here.
      </span>
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
        <div className="absolute right-0 top-10 z-30 w-72 rounded-xl border border-border-strong bg-surface p-1.5 shadow-2xl">
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
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="#06170f" strokeWidth={2}>
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
                  setManualCompare(false);
                  onCollapseToSingle();
                } else {
                  setManualCompare(true);
                }
              }}
              className="w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-accent hover:bg-surface-raised"
            >
              {compareMode ? "Back to a single camera" : "Compare multiple cameras"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
