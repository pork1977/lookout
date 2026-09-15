"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CameraTile from "./live-demo/CameraTile";
import CameraPicker from "./live-demo/CameraPicker";
import DetectionList from "./live-demo/DetectionList";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { useThemeColor } from "@/lib/useThemeColor";
import type { TrackedDetection } from "./live-demo/types";

const EXTRA_COLORS = ["#38bdf8", "#fb923c", "#f472b6"];
const MAX_CAMERAS = 4;

export default function LiveDemo() {
  const { cameras, hasLabels, refresh } = useMediaDevices();
  const accent = useThemeColor("--accent", "#5cf2a3");

  // Index 0 is always the primary tile (starts on click, stays mounted for
  // its whole life — switching its device swaps the stream in place rather
  // than remounting). Any further entries are grid additions the user
  // picked explicitly, so they're safe to auto-start immediately.
  const [activeIds, setActiveIds] = useState<Array<string | undefined>>([undefined]);
  const [hasStarted, setHasStarted] = useState(false);
  // Keyed by tile index (not label/order-of-arrival) so the list's order
  // always matches the on-screen tile order, not whichever camera's frame
  // happened to resolve first this tick.
  const [detectionsByTile, setDetectionsByTile] = useState<Record<number, TrackedDetection[]>>(
    {},
  );
  const [expanded, setExpanded] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    // entered starts (and is left) false whenever this effect isn't the
    // "open" case — either at mount, or because closeExpand() already set
    // it directly before expanded catches up on the next tick.
    if (!expanded) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeExpand();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
     
  }, [expanded]);

  function closeExpand() {
    setEntered(false);
    window.setTimeout(() => setExpanded(false), 220);
  }

  const colorFor = useCallback(
    (i: number) => (i === 0 ? accent : EXTRA_COLORS[(i - 1) % EXTRA_COLORS.length]),
    [accent],
  );

  const labelFor = useCallback(
    (deviceId: string | undefined, i: number) => {
      const found = deviceId ? cameras.find((c) => c.deviceId === deviceId) : undefined;
      return found?.label || `Camera ${i + 1}`;
    },
    [cameras],
  );

  const handleDetections = useCallback((tileIndex: number, detections: TrackedDetection[]) => {
    setDetectionsByTile((prev) => ({ ...prev, [tileIndex]: detections }));
  }, []);

  const handlePrimaryStart = useCallback(
    (deviceId?: string) => {
      setHasStarted(true);
      refresh();
      if (deviceId) setActiveIds((prev) => [deviceId, ...prev.slice(1)]);
    },
    [refresh],
  );

  // Radio behavior: replace whichever camera is primary with this one.
  function selectPrimary(deviceId: string) {
    setActiveIds([deviceId]);
  }

  // Checkbox behavior (compare mode): add/remove this camera from the grid.
  function toggleGridMember(deviceId: string) {
    setActiveIds((prev) => {
      if (prev.includes(deviceId)) {
        return prev.length > 1 ? prev.filter((id) => id !== deviceId) : prev;
      }
      return prev.length >= MAX_CAMERAS ? prev : [...prev, deviceId];
    });
  }

  function collapseToSingle() {
    setActiveIds((prev) => [prev[0]]);
  }

  function removeCamera(index: number) {
    setActiveIds((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const grid = activeIds.length > 1;

  const allDetections = useMemo(
    () => activeIds.flatMap((_, i) => detectionsByTile[i] ?? []),
    [activeIds, detectionsByTile],
  );

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CameraPicker
          cameras={cameras}
          hasLabels={hasLabels}
          activeIds={activeIds.filter((id): id is string => !!id)}
          maxActive={MAX_CAMERAS}
          onSelectPrimary={selectPrimary}
          onToggleGridMember={toggleGridMember}
          onCollapseToSingle={collapseToSingle}
        />
        {hasStarted && (
          <button
            onClick={() => setExpanded(true)}
            className="hidden items-center gap-1.5 rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised lg:flex"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6}>
              <path d="M6 2H2v4M10 14h4v-4M14 2 9 7M2 14l5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Expand
          </button>
        )}
      </div>

      {/* Single persistent wrapper: only its own styling toggles between
          inline flow and a fixed centered overlay, so the camera tiles
          underneath never remount (and never drop their MediaStream) when
          this expands or collapses. */}
      <div
        onClick={
          expanded
            ? (e) => {
                if (e.target === e.currentTarget) closeExpand();
              }
            : undefined
        }
        style={
          expanded
            ? {
                position: "fixed",
                inset: 0,
                zIndex: 50,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1.5rem",
                background: entered ? "rgba(3,5,4,0.75)" : "rgba(3,5,4,0)",
                backdropFilter: entered ? "blur(8px)" : "none",
                transition: "background 250ms ease, backdrop-filter 250ms ease",
              }
            : undefined
        }
      >
        <div
          className={expanded ? "glow-ring w-full rounded-2xl border border-border-strong bg-background" : "w-full"}
          style={
            expanded
              ? {
                  maxWidth: "1180px",
                  padding: "1.25rem",
                  maxHeight: "calc(100vh - 3rem)",
                  overflowY: "auto",
                  transform: entered ? "scale(1)" : "scale(0.94)",
                  opacity: entered ? 1 : 0,
                  transition: "transform 280ms cubic-bezier(0.2,0.8,0.2,1), opacity 220ms ease",
                }
              : undefined
          }
        >
          {expanded && (
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Live detection</span>
              <button
                onClick={closeExpand}
                className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised"
              >
                Close
              </button>
            </div>
          )}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
            <div className="min-w-0 flex-1">
              <div className={grid ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : ""}>
                {activeIds.map((deviceId, i) => (
                  <CameraTile
                    key={i}
                    deviceId={deviceId}
                    tileIndex={i}
                    cameraLabel={labelFor(deviceId, i)}
                    color={colorFor(i)}
                    compact={grid}
                    autoStart={i > 0}
                    onDetections={handleDetections}
                    onStart={i === 0 ? handlePrimaryStart : undefined}
                    onRemove={i > 0 ? () => removeCamera(i) : undefined}
                  />
                ))}
              </div>
            </div>

            <div className={expanded ? "w-full shrink-0 lg:min-h-0 lg:w-80" : "w-full shrink-0 lg:min-h-0 lg:w-72"}>
              <DetectionList detections={allDetections} showCamera={grid} />
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        This demo recognizes ~80 everyday objects out of the box. Your own custom detector (a
        specific mug, a specific gesture, whatever you like) is what the builder trains from your
        own photos.
      </p>
    </div>
  );
}
