"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ObjectDetection, DetectedObject } from "@tensorflow-models/coco-ssd";

type DemoStatus =
  | "idle"
  | "requesting-camera"
  | "loading-model"
  | "running"
  | "camera-denied"
  | "unsupported"
  | "error";

const BOX_COLOR = "#5cf2a3";

export default function LiveDemo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<ObjectDetection | null>(null);
  const rafRef = useRef<number | null>(null);

  const [status, setStatus] = useState<DemoStatus>("idle");
  const [liveCount, setLiveCount] = useState(0);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus("idle");
    setLiveCount(0);
  }, []);

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

        for (const p of predictions) {
          const [x, y, w, h] = p.bbox;
          const label = `${p.class} ${Math.round(p.score * 100)}%`;
          const bracket = Math.min(w, h) * 0.22;

          ctx.strokeStyle = BOX_COLOR;
          ctx.lineWidth = 3;
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

          ctx.font = "600 15px var(--font-sans, sans-serif)";
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = BOX_COLOR;
          ctx.fillRect(x, Math.max(0, y - 26), textWidth + 16, 24);
          ctx.fillStyle = "#06170f";
          ctx.fillText(label, x + 8, Math.max(0, y - 26) + 17);
        }

        rafRef.current = requestAnimationFrame(tick);
      });
    }

    tick();
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }

    setStatus("requesting-camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setStatus("camera-denied");
      return;
    }

    setStatus("loading-model");
    try {
      const [tf, cocoSsd] = await Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/coco-ssd"),
      ]);
      await tf.ready();
      modelRef.current = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    } catch {
      setStatus("error");
      return;
    }

    setStatus("running");
    rafRef.current = requestAnimationFrame(drawLoop);
  }, [drawLoop]);

  return (
    <div className="w-full">
      <div className="glow-ring relative aspect-video w-full overflow-hidden rounded-2xl border border-border-strong bg-surface">
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />

        {status !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/80 px-6 text-center backdrop-blur-sm">
            {status === "idle" && (
              <>
                <p className="max-w-sm text-sm text-muted">
                  This runs a real object-detection model, live, in this browser tab. Nothing is
                  uploaded anywhere.
                </p>
                <button
                  onClick={start}
                  className="rounded-full px-6 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
                  style={{
                    backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                  }}
                >
                  Try it on your camera
                </button>
              </>
            )}
            {status === "requesting-camera" && (
              <p className="text-sm text-muted">Waiting for camera permission…</p>
            )}
            {status === "loading-model" && (
              <p className="text-sm text-muted animate-scan-pulse">
                Loading the vision model into this tab…
              </p>
            )}
            {status === "camera-denied" && (
              <div className="max-w-sm space-y-3">
                <p className="text-sm text-foreground">
                  Camera access was blocked. Allow camera permission for this site and try again.
                </p>
                <button
                  onClick={start}
                  className="rounded-full border border-border-strong px-5 py-2.5 text-sm font-medium hover:bg-surface-raised"
                >
                  Try again
                </button>
              </div>
            )}
            {status === "unsupported" && (
              <p className="max-w-sm text-sm text-foreground">
                This browser doesn&apos;t support camera access. Try the latest Chrome, Edge,
                Firefox, or Safari.
              </p>
            )}
            {status === "error" && (
              <p className="max-w-sm text-sm text-foreground">
                The vision model failed to load. Check your connection and try again.
              </p>
            )}
          </div>
        )}

        {status === "running" && (
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-background/70 px-3 py-1.5 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="text-xs font-medium text-foreground">
              {liveCount > 0
                ? `Tracking ${liveCount} object${liveCount === 1 ? "" : "s"}`
                : "Watching…"}
            </span>
          </div>
        )}

        {status === "running" && (
          <button
            onClick={stop}
            className="absolute right-4 top-4 rounded-full bg-background/70 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur-sm hover:bg-background/90"
          >
            Stop
          </button>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        This demo recognizes ~80 everyday objects out of the box. Your own custom detector (a
        specific mug, a specific gesture, whatever you like) is what the builder trains from your
        own photos.
      </p>
    </div>
  );
}
