"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { DetectedObject } from "@tensorflow-models/coco-ssd";
import { ADMIT_SCORE, detect, detectorQuality, startDetector } from "@/lib/detectorModel";
import { inkFor } from "@/lib/colorInk";
import type { TrackedDetection } from "./types";

type TileStatus =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "running"
  | "camera-denied"
  | "unsupported"
  | "error";

/**
 * Floor on the gap between detections. Running detect() as fast as
 * requestAnimationFrame allows pins the GPU for no visible benefit — the boxes
 * already move faster than the eye reads them — and with three cameras sharing
 * one model it was a direct cause of stutter.
 */
const DETECT_INTERVAL_MS = 70;

/** How often confidence-only changes are allowed to reach React. */
const SCORE_REFRESH_MS = 400;

/** One persistent entry in this tile's tracking registry. Never deleted. */
interface RegistryEntry {
  slot: number;
  label: string;
  score: number;
  count: number;
  active: boolean;
}

interface CameraTileProps {
  /** Which camera to request. undefined = let the browser pick a default. */
  deviceId?: string;
  /**
   * Stable identity for this camera slot, assigned once when the slot is
   * created and never reused. Array position can't do this job: removing a
   * middle tile slides the others down, and React would then hand one tile's
   * persistent tracking history to a different camera.
   */
  uid: string;
  cameraLabel: string;
  color: string;
  compact?: boolean;
  /** Start immediately on mount (safe for tiles added after camera permission was already granted). */
  autoStart?: boolean;
  /** True when a tracking list is on screen, so boxes carry its numbers rather than plain text. */
  showBadgeNumbers?: boolean;
  onDetections: (uid: string, detections: TrackedDetection[]) => void;
  /** Fires once, the first time this tile successfully starts, with the actual device the browser picked. */
  onStart?: (deviceId: string | undefined) => void;
  onRemove?: (uid: string) => void;
}

function CameraTile({
  deviceId,
  uid,
  cameraLabel,
  color,
  compact = false,
  autoStart = false,
  showBadgeNumbers = false,
  onDetections,
  onStart,
  onRemove,
}: CameraTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeDeviceIdRef = useRef<string | undefined>(undefined);
  const hasStartedOnceRef = useRef(false);

  // Values the draw loop reads every frame. Held in refs so the loop's own
  // identity stays stable — recreating it would restart detection whenever the
  // theme color or the expanded state changed.
  const compactRef = useRef(compact);
  const colorRef = useRef(color);
  const cameraLabelRef = useRef(cameraLabel);
  const badgesRef = useRef(showBadgeNumbers);

  /**
   * Everything this camera has seen this session. Entries are added once and
   * then only toggle active/inactive — they are never removed, which is what
   * stops rows appearing and vanishing as detection wobbles.
   */
  const registryRef = useRef<Map<string, RegistryEntry>>(new Map());
  const lastSignatureRef = useRef("");
  const lastEmitRef = useRef(0);
  const lastDetectRef = useRef(0);
  /**
   * Bumped on every stop, device swap and unmount. An in-flight detect()
   * promise checks it before touching anything: without this, a call already
   * running when the tile stopped would resolve afterwards, re-arm
   * requestAnimationFrame and resurrect a loop nothing can cancel.
   */
  const generationRef = useRef(0);

  const [status, setStatus] = useState<TileStatus>("idle");
  const [liveCount, setLiveCount] = useState(0);
  const [quality, setQuality] = useState<"fast" | "accurate">("fast");

  // The detector starts on the small base and swaps itself for the accurate one
  // a few seconds later. Polling for that is worth the handful of lines: without
  // it, someone judging detection quality has no way to tell which model just
  // answered, and would be judging the warm-up model.
  useEffect(() => {
    if (status !== "running" || quality === "accurate") return;
    const id = window.setInterval(() => {
      if (detectorQuality() === "accurate") setQuality("accurate");
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, quality]);

  useEffect(() => {
    compactRef.current = compact;
    colorRef.current = color;
    cameraLabelRef.current = cameraLabel;
    badgesRef.current = showBadgeNumbers;
  }, [compact, color, cameraLabel, showBadgeNumbers]);

  const emit = useCallback(
    (force: boolean) => {
      const entries = [...registryRef.current.values()].sort((a, b) => a.slot - b.slot);
      const signature = entries.map((e) => `${e.slot}${e.active ? "+" : "-"}${e.count}`).join("|");
      const now = performance.now();

      // Confidence drifts on every single frame. Re-rendering the whole demo
      // for that is what made the layout churn, so only a change in *which*
      // objects are present pushes through immediately; score updates are
      // rate-limited.
      if (
        !force &&
        signature === lastSignatureRef.current &&
        now - lastEmitRef.current < SCORE_REFRESH_MS
      ) {
        return;
      }
      lastSignatureRef.current = signature;
      lastEmitRef.current = now;

      const cameraColor = colorRef.current;
      onDetections(
        uid,
        entries.map((e) => ({
          key: `${uid}:${e.label}`,
          index: e.slot,
          label: e.label,
          score: e.score,
          count: e.count,
          active: e.active,
          cameraLabel: cameraLabelRef.current,
          cameraColor,
          cameraInk: inkFor(cameraColor),
        })),
      );
    },
    [uid, onDetections],
  );

  const teardown = useCallback(() => {
    generationRef.current += 1;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Unmount cleanup only releases the camera. It deliberately does not emit:
  // the parent drops this uid's detections itself, and an emit on the way out
  // would immediately put them back.
  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
    setLiveCount(0);
    for (const entry of registryRef.current.values()) entry.active = false;
    emit(true);
  }, [teardown, emit]);

  const startLoop = useCallback(() => {
    const generation = generationRef.current;

    function updateRegistry(predictions: DetectedObject[]) {
      const frame = new Map<string, { score: number; count: number }>();
      for (const p of predictions) {
        const seen = frame.get(p.class);
        if (seen) {
          seen.count += 1;
          seen.score = Math.max(seen.score, p.score);
        } else {
          frame.set(p.class, { score: p.score, count: 1 });
        }
      }

      const registry = registryRef.current;
      for (const [label, seen] of frame) {
        let entry = registry.get(label);
        if (!entry) {
          // A brand-new class has to clear the high bar to earn a permanent
          // row; one already in the list only has to clear the low one to stay
          // active. A single threshold would either make one frame of noise
          // permanent or drop real objects the moment they turn or dim.
          if (seen.score < ADMIT_SCORE) continue;
          entry = {
            slot: registry.size + 1,
            label,
            score: seen.score,
            count: seen.count,
            active: true,
          };
          registry.set(label, entry);
        }
        entry.score = seen.score;
        entry.count = seen.count;
        entry.active = true;
      }
      for (const [label, entry] of registry) {
        if (!frame.has(label)) entry.active = false;
      }
    }

    function draw(
      ctx: CanvasRenderingContext2D,
      canvas: HTMLCanvasElement,
      predictions: DetectedObject[],
    ) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // The canvas is sized in camera pixels but displayed much smaller, so a
      // fixed pixel size drew microscopic text on a 1080p webcam and huge text
      // on a 480p one. Converting once per frame keeps every overlay the same
      // on-screen size whatever the camera's resolution is.
      const pxPerCss = Math.max(
        1,
        Math.min(
          canvas.width / Math.max(canvas.clientWidth, 1),
          canvas.height / Math.max(canvas.clientHeight, 1),
        ),
      );

      const compactNow = compactRef.current;
      const colorNow = colorRef.current;
      const ink = inkFor(colorNow);
      const registry = registryRef.current;
      const fontSize = (compactNow ? 11 : 13) * pxPerCss;

      ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      let drawn = 0;
      for (const p of predictions) {
        const entry = registry.get(p.class);
        // Classes that never cleared the admission bar aren't drawn either, so
        // boxes and list always show exactly the same set of objects.
        if (!entry) continue;
        drawn += 1;

        const [rawX, y, w, h] = p.bbox;
        // The video renders mirrored (selfie view) via a CSS flip on the
        // <video> element only — the canvas itself is NOT flipped, so text
        // drawn on it stays readable. Boxes are mirrored manually here to line
        // up with the mirrored video underneath.
        const x = canvas.width - rawX - w;
        const bracket = Math.min(w, h) * 0.22;

        ctx.strokeStyle = colorNow;
        ctx.lineWidth = (compactNow ? 2 : 2.5) * pxPerCss;
        ctx.lineJoin = "round";

        const corners: Array<[number, number, number, number]> = [
          [x, y, bracket, 0],
          [x, y, 0, bracket],
          [x + w, y, -bracket, 0],
          [x + w, y, 0, bracket],
          [x, y + h, bracket, 0],
          [x, y + h, 0, -bracket],
          [x + w, y + h, -bracket, 0],
          [x + w, y + h, 0, -bracket],
        ];
        for (const [cx, cy, dx, dy] of corners) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + dx, cy + dy);
          ctx.stroke();
        }

        // With a tracking list on screen the box carries its row number; with
        // no list (the normal, larger view) it carries the name instead, so the
        // numbers are never left pointing at nothing.
        const pct = `${Math.round(p.score * 100)}%`;
        const text = badgesRef.current
          ? `${entry.slot}  ${p.class}  ${pct}`
          : `${p.class}  ${pct}`;

        const padX = fontSize * 0.55;
        const pillH = fontSize * 1.85;
        const pillW = ctx.measureText(text).width + padX * 2;
        const gap = 4 * pxPerCss;
        const above = y - pillH - gap;
        const pillY = above > 0 ? above : y + gap;
        const pillX = Math.max(0, Math.min(x, canvas.width - pillW));

        ctx.fillStyle = colorNow;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        } else {
          ctx.rect(pillX, pillY, pillW, pillH);
        }
        ctx.fill();

        ctx.fillStyle = ink;
        ctx.fillText(text, pillX + padX, pillY + pillH / 2);
      }

      // Same value in means React bails out, so this is a no-op on most frames.
      setLiveCount(drawn);
    }

    function tick() {
      if (generation !== generationRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      // Every early exit has to re-arm, or the loop dies silently while the
      // tile still reads "running".
      if (!video || !canvas || !ctx || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      if (now - lastDetectRef.current < DETECT_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastDetectRef.current = now;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      detect(video)
        .then((predictions) => {
          if (generation !== generationRef.current) return;
          updateRegistry(predictions);
          draw(ctx, canvas, predictions);
          emit(false);
          rafRef.current = requestAnimationFrame(tick);
        })
        .catch(() => {
          // A single failed frame shouldn't end the session.
          if (generation !== generationRef.current) return;
          rafRef.current = requestAnimationFrame(tick);
        });
    }

    tick();
  }, [emit]);

  const requestStream = useCallback(async (targetDeviceId: string | undefined) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: targetDeviceId
        ? {
            deviceId: { exact: targetDeviceId },
            width: { ideal: compactRef.current ? 480 : 960 },
            height: { ideal: compactRef.current ? 360 : 720 },
          }
        : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    activeDeviceIdRef.current = stream.getVideoTracks()[0]?.getSettings().deviceId;
    return activeDeviceIdRef.current;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting-camera");
    let resolvedId: string | undefined;
    try {
      resolvedId = await requestStream(deviceId);
    } catch {
      setStatus("camera-denied");
      return;
    }

    setStatus("loading-model");
    try {
      await startDetector();
    } catch {
      setStatus("error");
      return;
    }

    hasStartedOnceRef.current = true;
    setStatus("running");
    onStart?.(resolvedId);
    startLoop();
  }, [deviceId, requestStream, startLoop, onStart]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    if (autoStart) startRef.current();
    // Mount-time instruction only; not re-run when start()'s identity changes.

  }, [autoStart]);

  // Switching the picker's selection for an already-running tile: swap the
  // stream to the new device without unmounting (which would drop the canvas
  // and flicker). Skip entirely if this is the very first mount, or if
  // `deviceId` just caught up to the device already in use (e.g. the initial
  // "browser default" camera resolving to a real id).
  useEffect(() => {
    if (!hasStartedOnceRef.current || !deviceId || deviceId === activeDeviceIdRef.current) return;
    (async () => {
      teardown();
      // A different camera is a different scene, so its tracking history starts
      // over rather than inheriting the previous device's objects.
      registryRef.current.clear();
      lastSignatureRef.current = "";
      emit(true);
      setStatus("requesting-camera");
      try {
        await requestStream(deviceId);
      } catch {
        setStatus("camera-denied");
        return;
      }
      setStatus("running");
      startLoop();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-surface"
      style={{
        borderColor: status === "running" ? `${color}55` : "var(--border-strong)",
        boxShadow:
          status === "running" ? `0 0 0 1px ${color}33, 0 20px 50px -25px ${color}77` : undefined,
        aspectRatio: "16 / 9",
      }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

      {status !== "running" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 px-6 text-center backdrop-blur-sm">
          {status === "idle" && !autoStart && (
            <>
              <button
                onClick={start}
                className="whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_8px_20px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
                style={{
                  backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                }}
              >
                Try it on your camera
              </button>
              <p className={compact ? "text-[11px] text-muted" : "max-w-sm text-xs text-muted"}>
                Runs a real object-detection model live in this tab. Nothing is uploaded anywhere.
              </p>
            </>
          )}
          {(status === "idle" && autoStart) || status === "requesting-camera" ? (
            <p className="text-xs text-muted">Waiting for camera permission…</p>
          ) : null}
          {status === "loading-model" && (
            <p className="animate-scan-pulse text-xs text-muted">Loading the vision model…</p>
          )}
          {status === "camera-denied" && (
            <div className="max-w-sm space-y-3">
              <p className="text-sm text-foreground">
                {cameraLabel} was blocked or is unavailable. Allow camera permission and try again.
              </p>
              <button
                onClick={start}
                className="rounded-full border border-border-strong px-5 py-2 text-xs font-medium hover:bg-surface-raised"
              >
                Try again
              </button>
            </div>
          )}
          {status === "unsupported" && (
            <p className="max-w-sm text-sm text-foreground">
              This browser doesn&apos;t support camera access.
            </p>
          )}
          {status === "error" && (
            <p className="max-w-sm text-sm text-foreground">The vision model failed to load.</p>
          )}
        </div>
      )}

      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-background/70 px-2.5 py-1 backdrop-blur-sm">
        <span className="relative flex h-1.5 w-1.5">
          {status === "running" && (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: color }}
            />
          )}
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ background: status === "running" ? color : "var(--muted)" }}
          />
        </span>
        <span className="text-[11px] font-medium text-foreground">{cameraLabel}</span>
      </div>

      {status === "running" && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {quality === "fast" && (
            <span
              title="Running the quick model while the more accurate one finishes downloading."
              className="animate-scan-pulse rounded-full bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted backdrop-blur-sm"
            >
              refining
            </span>
          )}
          <span className="rounded-full bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted backdrop-blur-sm">
            {liveCount > 0 ? `${liveCount} tracked` : "watching"}
          </span>
          <button
            onClick={stop}
            className="rounded-full bg-background/70 px-2.5 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm hover:bg-background/90"
          >
            Stop
          </button>
        </div>
      )}
      {onRemove && (
        <button
          onClick={() => onRemove(uid)}
          aria-label={`Remove ${cameraLabel}`}
          className="absolute bottom-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-background/70 text-xs text-muted backdrop-blur-sm hover:bg-background/90 hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Detection state updates land on the parent several times a second. Without
// this, every one of those re-rendered every camera tile on the page.
export default memo(CameraTile);
