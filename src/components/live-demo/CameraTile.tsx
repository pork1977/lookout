"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DetectedObject, ObjectDetection } from "@tensorflow-models/coco-ssd";
import { loadDetectorModel } from "@/lib/detectorModel";
import type { TrackedDetection } from "./types";

type TileStatus =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "running"
  | "camera-denied"
  | "unsupported"
  | "error";

interface CameraTileProps {
  /** Which camera to request. undefined = let the browser pick a default. */
  deviceId?: string;
  cameraLabel: string;
  color: string;
  compact?: boolean;
  /** Start immediately on mount (safe for tiles added after the user has already granted camera permission once). */
  autoStart?: boolean;
  onDetections: (cameraLabel: string, detections: TrackedDetection[]) => void;
  /** Fires once, the first time this tile successfully starts, with the actual device the browser picked. */
  onStart?: (deviceId: string | undefined) => void;
  onRemove?: () => void;
}

export default function CameraTile({
  deviceId,
  cameraLabel,
  color,
  compact = false,
  autoStart = false,
  onDetections,
  onStart,
  onRemove,
}: CameraTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<ObjectDetection | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeDeviceIdRef = useRef<string | undefined>(undefined);
  const hasStartedOnceRef = useRef(false);
  const compactRef = useRef(compact);
  const colorRef = useRef(color);

  const [status, setStatus] = useState<TileStatus>("idle");
  const [liveCount, setLiveCount] = useState(0);

  useEffect(() => {
    compactRef.current = compact;
    colorRef.current = color;
  }, [compact, color]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus("idle");
    setLiveCount(0);
    onDetections(cameraLabel, []);
  }, [cameraLabel, onDetections]);

  useEffect(() => stop, [stop]);

  const drawLoop = useCallback(() => {
    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const model = modelRef.current;
      if (!video || !canvas || !model || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      model.detect(video).then((predictions: DetectedObject[]) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setLiveCount(predictions.length);

        const compactNow = compactRef.current;
        const colorNow = colorRef.current;

        const tracked: TrackedDetection[] = predictions.map((p, i) => ({
          index: i + 1,
          label: p.class,
          score: p.score,
          cameraLabel,
          cameraColor: colorNow,
        }));
        onDetections(cameraLabel, tracked);

        predictions.forEach((p, i) => {
          const [x, y, w, h] = p.bbox;
          const bracket = Math.min(w, h) * 0.22;

          ctx.strokeStyle = colorNow;
          ctx.lineWidth = compactNow ? 2 : 3;
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

          const badgeRadius = compactNow ? 9 : 12;
          const badgeX = x + badgeRadius + 2;
          const badgeY = y + badgeRadius + 2;
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
          ctx.fillStyle = colorNow;
          ctx.fill();
          ctx.font = `700 ${compactNow ? 11 : 13}px var(--font-sans, sans-serif)`;
          ctx.fillStyle = "#06170f";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), badgeX, badgeY + 0.5);
          ctx.textAlign = "start";
          ctx.textBaseline = "alphabetic";
        });

        rafRef.current = requestAnimationFrame(tick);
      });
    }

    tick();
  }, [cameraLabel, onDetections]);

  const requestStream = useCallback(
    async (targetDeviceId: string | undefined) => {
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
    },
    [],
  );

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
      modelRef.current = await loadDetectorModel();
    } catch {
      setStatus("error");
      return;
    }

    hasStartedOnceRef.current = true;
    setStatus("running");
    onStart?.(resolvedId);
    rafRef.current = requestAnimationFrame(drawLoop);
  }, [deviceId, requestStream, drawLoop, onStart]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    if (autoStart) startRef.current();
    // Mount-time instruction only; not re-run when start()'s identity changes.
     
  }, [autoStart]);

  // Switching the picker's selection for an already-running tile: swap the
  // stream to the new device without unmounting (which would drop the
  // model/canvas and flicker). Skip entirely if this is the very first
  // mount, or if `deviceId` just caught up to the device already in use
  // (e.g. the initial "browser default" camera resolving to a real id).
  useEffect(() => {
    if (!hasStartedOnceRef.current || !deviceId || deviceId === activeDeviceIdRef.current) return;
    (async () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setStatus("requesting-camera");
      try {
        await requestStream(deviceId);
      } catch {
        setStatus("camera-denied");
        return;
      }
      setStatus("running");
      rafRef.current = requestAnimationFrame(drawLoop);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-surface"
      style={{
        borderColor: status === "running" ? `${color}55` : "var(--border-strong)",
        boxShadow: status === "running" ? `0 0 0 1px ${color}33, 0 20px 50px -25px ${color}77` : undefined,
        aspectRatio: "16 / 9",
      }}
    >
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />

      {status !== "running" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 px-6 text-center backdrop-blur-sm">
          {status === "idle" && !autoStart && (
            <>
              <p className={compact ? "text-xs text-muted" : "max-w-sm text-sm text-muted"}>
                This runs a real object-detection model, live, in this browser tab. Nothing is
                uploaded anywhere.
              </p>
              <button
                onClick={start}
                className="rounded-full px-6 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
                style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
              >
                Try it on your camera
              </button>
            </>
          )}
          {(status === "idle" && autoStart) || status === "requesting-camera" ? (
            <p className="text-xs text-muted">Waiting for camera permission…</p>
          ) : null}
          {status === "loading-model" && (
            <p className="text-xs text-muted animate-scan-pulse">Loading the vision model…</p>
          )}
          {status === "camera-denied" && (
            <div className="max-w-sm space-y-3">
              <p className="text-sm text-foreground">
                {cameraLabel} was blocked or is unavailable. Allow camera permission and try
                again.
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
          onClick={onRemove}
          aria-label={`Remove ${cameraLabel}`}
          className="absolute bottom-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-background/70 text-xs text-muted backdrop-blur-sm hover:bg-background/90 hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}
