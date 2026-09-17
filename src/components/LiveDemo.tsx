"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraTile from "./live-demo/CameraTile";
import CameraPicker from "./live-demo/CameraPicker";
import DetectionList from "./live-demo/DetectionList";
import { useMediaDevices } from "@/lib/useMediaDevices";
import { useThemeColor } from "@/lib/useThemeColor";
import type { DetectionGroup, TrackedDetection } from "./live-demo/types";

const EXTRA_COLORS = ["#38bdf8", "#fb923c", "#f472b6"];
const MAX_CAMERAS = 4;

/**
 * One active camera. `uid` is assigned when the slot is created and never
 * reused, which is what lets a tile hold session-long tracking history:
 * keying by array position meant removing a middle camera slid the others
 * down and handed one camera's history to another.
 */
interface CameraSlot {
  uid: string;
  deviceId?: string;
  /**
   * Overrides the default "everything after the first tile starts itself".
   * Set when the user fills the untouched primary slot from the picker, which
   * is an explicit enough choice to start on, and means it behaves like the
   * sibling tiles it was picked alongside rather than sitting on a button.
   */
  autoStart?: boolean;
}

export default function LiveDemo() {
  const { cameras, hasLabels, refresh } = useMediaDevices();
  const accent = useThemeColor("--accent", "#5cf2a3");

  // Slot 0 is always the primary tile (starts on click, stays mounted for its
  // whole life, switching its device swaps the stream in place rather than
  // remounting). Any further slots are grid additions the user picked
  // explicitly, so they're safe to auto-start immediately.
  const [slots, setSlots] = useState<CameraSlot[]>([{ uid: "cam-0" }]);
  const nextUid = useRef(1);
  const [detectionsByUid, setDetectionsByUid] = useState<Record<string, TrackedDetection[]>>({});
  // Lifted out of CameraPicker: the picker now renders in two places at once,
  // and compare mode has to mean the same thing in both.
  const [compareMode, setCompareMode] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [entered, setEntered] = useState(false);

  const closeExpand = useCallback(() => {
    setEntered(false);
    window.setTimeout(() => setExpanded(false), 220);
  }, []);

  useEffect(() => {
    // entered starts (and is left) false whenever this effect isn't the
    // "open" case, either at mount, or because closeExpand() already set it
    // directly before expanded catches up on the next tick.
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
  }, [expanded, closeExpand]);

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

  const handleDetections = useCallback((uid: string, detections: TrackedDetection[]) => {
    setDetectionsByUid((prev) => ({ ...prev, [uid]: detections }));
  }, []);

  const handlePrimaryStart = useCallback(
    (deviceId?: string) => {
      refresh();
      if (deviceId) {
        setSlots((prev) => [{ ...prev[0], deviceId }, ...prev.slice(1)]);
      }
    },
    [refresh],
  );

  // Radio behavior: replace whichever camera is primary with this one. The uid
  // is carried over deliberately so the tile swaps its stream rather than
  // remounting and re-prompting for permission.
  const selectPrimary = useCallback((deviceId: string) => {
    setSlots((prev) => [{ uid: prev[0].uid, deviceId }]);
  }, []);

  // Checkbox behavior (compare mode): add/remove this camera from the grid.
  const toggleGridMember = useCallback((deviceId: string) => {
    const uid = `cam-${nextUid.current}`;
    setSlots((prev) => {
      if (prev.some((s) => s.deviceId === deviceId)) {
        return prev.length > 1 ? prev.filter((s) => s.deviceId !== deviceId) : prev;
      }
      if (prev.length >= MAX_CAMERAS) return prev;

      // The primary slot exists from page load with no device attached. Always
      // appending meant picking three cameras before ever starting one left an
      // empty fourth tile sitting beside them, so fill that slot first.
      const vacant = prev.findIndex((s) => !s.deviceId);
      if (vacant !== -1) {
        const next = [...prev];
        next[vacant] = { ...next[vacant], deviceId, autoStart: true };
        return next;
      }
      return [...prev, { uid, deviceId }];
    });
    nextUid.current += 1;
  }, []);

  const collapseToSingle = useCallback(() => {
    setSlots((prev) => prev.slice(0, 1));
  }, []);

  const removeCamera = useCallback((uid: string) => {
    setSlots((prev) => (prev.length > 1 ? prev.filter((s) => s.uid !== uid) : prev));
  }, []);

  const grid = slots.length > 1;
  const activeIds = useMemo(
    () => slots.map((s) => s.deviceId).filter((id): id is string => !!id),
    [slots],
  );

  // Built from the live slots, so a removed camera's rows disappear with it and
  // the record needs no pruning. Camera identity is attached here rather than
  // inside each detection: the tiles emit behind a change-signature throttle
  // that can't see a theme switch, so sourcing color at this level means a
  // theme change repaints the list immediately.
  const groups: DetectionGroup[] = useMemo(
    () =>
      slots.map((s, i) => ({
        uid: s.uid,
        cameraLabel: labelFor(s.deviceId, i),
        cameraColor: colorFor(i),
        detections: detectionsByUid[s.uid] ?? [],
      })),
    [slots, detectionsByUid, labelFor, colorFor],
  );

  const picker = (
    <CameraPicker
      cameras={cameras}
      hasLabels={hasLabels}
      activeIds={activeIds}
      maxActive={MAX_CAMERAS}
      compareMode={compareMode}
      onCompareModeChange={setCompareMode}
      onSelectPrimary={selectPrimary}
      onToggleGridMember={toggleGridMember}
      onCollapseToSingle={collapseToSingle}
    />
  );

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {picker}
        {/* Always available, whatever the camera is doing, it used to appear
            only once a stream was running, which made it feel like it came and
            went. */}
        <button
          onClick={() => setExpanded(true)}
          className="hidden items-center gap-1.5 rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised lg:flex"
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
          >
            <path d="M6 2H2v4M10 14h4v-4M14 2 9 7M2 14l5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Expand
        </button>
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
          className={
            expanded
              ? "glow-ring w-full rounded-2xl border border-border-strong bg-background"
              : "w-full"
          }
          style={
            expanded
              ? {
                  maxWidth: "1180px",
                  padding: "1.25rem",
                  maxHeight: "calc(100vh - 3rem)",
                  // The panel itself must not scroll: the camera picker's
                  // dropdown lives in the header and would be clipped by it.
                  // Scrolling is delegated to the body row below instead.
                  display: "flex",
                  flexDirection: "column",
                  overflow: "visible",
                  transform: entered ? "scale(1)" : "scale(0.94)",
                  opacity: entered ? 1 : 0,
                  transition: "transform 280ms cubic-bezier(0.2,0.8,0.2,1), opacity 220ms ease",
                }
              : undefined
          }
        >
          {expanded && (
            <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-foreground">Live detection</span>
                {picker}
              </div>
              <button
                onClick={closeExpand}
                className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised"
              >
                Close
              </button>
            </div>
          )}

          <div
            className={
              expanded
                ? "flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch"
                : "w-full"
            }
            style={expanded ? { overflowY: "auto", scrollbarGutter: "stable" } : undefined}
          >
            <div className="min-w-0 flex-1">
              <div className={grid ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : ""}>
                {slots.map((slot, i) => (
                  <CameraTile
                    key={slot.uid}
                    uid={slot.uid}
                    deviceId={slot.deviceId}
                    cameraLabel={labelFor(slot.deviceId, i)}
                    color={colorFor(i)}
                    compact={grid}
                    autoStart={slot.autoStart ?? i > 0}
                    showBadgeNumbers={expanded}
                    onDetections={handleDetections}
                    onStart={i === 0 ? handlePrimaryStart : undefined}
                    onRemove={i > 0 ? removeCamera : undefined}
                  />
                ))}
              </div>
            </div>

            {/* Tracking lives in the expanded view only. Inline, it competed
                with the camera for width and its growing/shrinking height was
                what pushed the whole frame around. */}
            {expanded && (
              <div
                className="w-full shrink-0 lg:min-h-0 lg:w-80"
                style={{ maxHeight: "60vh" }}
              >
                <DetectionList groups={groups} grouped={grid} />
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        This demo recognises about 80 everyday objects without any training. For something more
        specific, like a particular mug or gesture, the builder trains a detector from your own
        photos.
      </p>
    </div>
  );
}
