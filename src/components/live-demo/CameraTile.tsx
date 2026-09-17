"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ADMIT_SCORE,
  detect,
  startDetector,
  type DetectedObject,
} from "@/lib/detectorModel";
import { inkFor } from "@/lib/colorInk";
import { classifyCameraError, openCameraStream } from "@/lib/cameraStream";
import type { TrackedDetection } from "./types";

type TileStatus =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "running"
  | "camera-denied"
  | "camera-busy"
  | "unsupported"
  | "error";

/**
 * Floor on the gap between detections. Running detect() as fast as
 * requestAnimationFrame allows pins the GPU for no visible benefit, the boxes
 * already move faster than the eye reads them, and with three cameras sharing
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
  // identity stays stable, recreating it would restart detection whenever the
  // theme color or the expanded state changed.
  const compactRef = useRef(compact);
  const colorRef = useRef(color);
  const badgesRef = useRef(showBadgeNumbers);

  /**
   * Everything this camera has seen this session. Entries are added once and
   * then only toggle active/inactive, they are never removed, which is what
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
  /**
   * `autoStart` means "start on mount", and it was also standing in for "this
   * tile is never started by hand", which left a stopped grid camera with no
   * way back, showing "waiting for permission" forever. This splits the two.
   */
  const [everStarted, setEverStarted] = useState(false);

  useEffect(() => {
    compactRef.current = compact;
    colorRef.current = color;
    badgesRef.current = showBadgeNumbers;
  }, [compact, color, showBadgeNumbers]);

  // Going into grid mode means more cameras are competing for the same USB
  // bandwidth, so the already-running tile gives some back rather than holding
  // the full-size stream it opened with. A rejection here is fine, the stream
  // simply keeps its current resolution.
  useEffect(() => {
    if (!compact) return;
    const track = streamRef.current?.getVideoTracks()[0];
    void track
      ?.applyConstraints({
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 20 },
      })
      .catch(() => undefined);
  }, [compact]);

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

      // Camera identity deliberately isn't part of this payload: it lives on
      // the group in the parent, so a theme change repaints immediately instead
      // of waiting for the next signature change to push a new color through.
      onDetections(
        uid,
        entries.map((e) => ({
          key: `${uid}:${e.label}`,
          index: e.slot,
          label: e.label,
          score: e.score,
          count: e.count,
          active: e.active,
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
        // <video> element only, the canvas itself is NOT flipped, so text
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
    const stream = await openCameraStream(
      targetDeviceId,
      targetDeviceId
        ? {
            deviceId: { exact: targetDeviceId },
            width: { ideal: compactRef.current ? 480 : 960 },
            height: { ideal: compactRef.current ? 360 : 720 },
          }
        : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
    );

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

    // Start the model download alongside the permission prompt rather than
    // after it. The prompt can sit open for a while, and that time was wasted.
    const detectorReady = startDetector();
    detectorReady.catch(() => undefined);

    setStatus("requesting-camera");
    let resolvedId: string | undefined;
    try {
      resolvedId = await requestStream(deviceId);
    } catch (err) {
      setStatus(classifyCameraError(err) === "busy" ? "camera-busy" : "camera-denied");
      return;
    }

    setStatus("loading-model");
    try {
      await detectorReady;
    } catch {
      setStatus("error");
      return;
    }

    hasStartedOnceRef.current = true;
    setEverStarted(true);
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
      } catch (err) {
        setStatus(classifyCameraError(err) === "busy" ? "camera-busy" : "camera-denied");
        return;
      }
      setStatus("running");
      startLoop();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const chip =
    "tile-chip flex items-center rounded-full bg-background/70 font-medium backdrop-blur-sm";
  const chipPad = { padding: "0.35em 0.75em", gap: "0.5em" } as const;

  return (
    <div
      className="tile-container tile-inset relative overflow-hidden rounded-2xl border bg-surface"
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
        <div
          className="tile-body absolute inset-0 flex flex-col items-center justify-center overflow-y-auto bg-background/80 text-center backdrop-blur-sm"
          // em throughout, so padding and gaps track the container-scaled font
          // size rather than staying at desktop proportions on a small tile.
          style={{ gap: "0.7em", padding: "1em 1.6em" }}
        >
          {status === "idle" && (everStarted || !autoStart) && (
            <>
              <button
                onClick={start}
                className="tile-action whitespace-nowrap rounded-full font-semibold text-accent-ink shadow-[0_8px_20px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
                style={{
                  padding: "0.6em 1.5em",
                  backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                }}
              >
                {everStarted ? "Start camera" : "Try it on your camera"}
              </button>
              {!everStarted && (
                <p className="max-w-sm text-muted" style={{ fontSize: "0.88em" }}>
                  Object detection runs in this tab, and the video isn&apos;t uploaded.
                </p>
              )}
            </>
          )}
          {(status === "idle" && autoStart && !everStarted) || status === "requesting-camera" ? (
            <p className="text-muted">Waiting for camera permission…</p>
          ) : null}
          {status === "loading-model" && (
            <p className="animate-scan-pulse text-muted">Loading the vision model…</p>
          )}
          {(status === "camera-denied" || status === "camera-busy") && (
            <div
              className="flex max-w-sm flex-col items-center"
              style={{ gap: "0.75em" }}
            >
              <p className="text-foreground">
                {status === "camera-denied" ? (
                  <>{cameraLabel} was blocked. Allow camera permission and try again.</>
                ) : compact ? (
                  // The full explanation doesn't fit a grid tile at a legible
                  // size, so the small view gets the actionable half of it.
                  <>{cameraLabel} couldn&apos;t start. Try stopping one of the other cameras.</>
                ) : (
                  <>
                    {cameraLabel} couldn&apos;t start. It may be in use by another app, or your USB
                    controller may not have the bandwidth for this many cameras at once. Try
                    stopping one of the others.
                  </>
                )}
              </p>
              <button
                onClick={start}
                className="tile-action shrink-0 whitespace-nowrap rounded-full border border-border-strong font-medium hover:bg-surface-raised"
                style={{ padding: "0.5em 1.3em" }}
              >
                Try again
              </button>
            </div>
          )}
          {status === "unsupported" && (
            <p className="max-w-sm text-foreground">
              This browser doesn&apos;t support camera access.
            </p>
          )}
          {status === "error" && (
            <p className="max-w-sm text-foreground">The vision model failed to load.</p>
          )}
        </div>
      )}

      {/* One row rather than two independently positioned clusters: the label
          then truncates against whatever width the controls actually leave,
          instead of against a guessed percentage that a long device name and a
          full control set could still overrun on a narrow grid tile. */}
      <div
        className="absolute flex items-start justify-between"
        style={{
          left: "var(--tile-inset)",
          right: "var(--tile-inset)",
          top: "var(--tile-inset)",
          gap: "0.5em",
        }}
      >
        <div className={`${chip} min-w-0 text-foreground`} style={chipPad}>
          <span className="relative flex h-1.5 w-1.5 shrink-0">
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
          <span className="truncate">{cameraLabel}</span>
        </div>

        {status === "running" && (
          <div className="flex shrink-0 items-center" style={{ gap: "0.4em" }}>
            <span className={`${chip} whitespace-nowrap text-muted`} style={chipPad}>
              {liveCount > 0 ? `${liveCount} tracked` : "watching"}
            </span>
            <button
              onClick={stop}
              className={`${chip} text-foreground hover:bg-background/90`}
              style={chipPad}
            >
              Stop
            </button>
          </div>
        )}
      </div>

      {onRemove && (
        <button
          onClick={() => onRemove(uid)}
          aria-label={`Remove ${cameraLabel}`}
          className="tile-chip absolute flex items-center justify-center rounded-full bg-background/70 text-muted backdrop-blur-sm hover:bg-background/90 hover:text-foreground"
          style={{
            right: "var(--tile-inset)",
            bottom: "var(--tile-inset)",
            width: "2em",
            height: "2em",
          }}
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
