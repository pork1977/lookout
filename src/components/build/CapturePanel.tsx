"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyCameraError, openCameraStream } from "@/lib/cameraStream";
import { fileToBlob, frameToBlob, isImageFile } from "@/lib/imageCapture";
import { useMediaDevices } from "@/lib/useMediaDevices";

type CameraState = "idle" | "starting" | "running" | "denied" | "busy" | "unsupported";

/** Roughly six frames a second while the button is held — fast enough to build a set, slow enough to move between shots. */
const BURST_INTERVAL_MS = 160;

export default function CapturePanel({
  targetName,
  onCapture,
  onUpload,
}: {
  /** Which group new photos land in, shown on the button so it's never ambiguous. */
  targetName: string;
  onCapture: (blob: Blob) => void;
  onUpload: (blobs: Blob[]) => void;
}) {
  const { cameras, hasLabels, refresh } = useMediaDevices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const burstRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<CameraState>("idle");
  const [deviceId, setDeviceId] = useState<string>("");
  const [captured, setCaptured] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(
    async (requested?: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("unsupported");
        return;
      }
      setState("starting");
      stopCamera();
      try {
        const stream = await openCameraStream(
          requested || undefined,
          requested
            ? { deviceId: { exact: requested }, width: { ideal: 960 }, height: { ideal: 720 } }
            : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        );
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? "");
        setState("running");
        refresh();
      } catch (err) {
        setState(classifyCameraError(err));
      }
    },
    [stopCamera, refresh],
  );

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    // Same guard as the detection loop: a frame grabbed before the video has
    // data is a blank square, and it would go straight into the training set.
    if (!video || video.readyState < 2) return;
    try {
      onCapture(await frameToBlob(video));
      setCaptured((n) => n + 1);
    } catch {
      /* one dropped frame isn't worth interrupting a burst for */
    }
  }, [onCapture]);

  const endBurst = useCallback(() => {
    if (burstRef.current !== null) window.clearInterval(burstRef.current);
    burstRef.current = null;
  }, []);

  useEffect(() => () => endBurst(), [endBurst]);

  function beginBurst(e: React.PointerEvent<HTMLButtonElement>) {
    if (state !== "running") return;
    // Without pointer capture, dragging off the button loses the release event
    // and the burst runs forever.
    e.currentTarget.setPointerCapture(e.pointerId);
    void captureFrame();
    endBurst();
    burstRef.current = window.setInterval(() => void captureFrame(), BURST_INTERVAL_MS);
  }

  const ingestFiles = useCallback(
    async (files: FileList | File[]) => {
      const images = Array.from(files).filter(isImageFile);
      const rejected = Array.from(files).length - images.length;
      setUploadError(
        rejected > 0
          ? rejected === 1
            ? "Skipped 1 file that wasn't an image."
            : `Skipped ${rejected} files that weren't images.`
          : null,
      );
      if (!images.length) return;

      const results = await Promise.allSettled(images.map(fileToBlob));
      const blobs = results
        .filter((r): r is PromiseFulfilledResult<Blob> => r.status === "fulfilled")
        .map((r) => r.value);
      if (blobs.length) onUpload(blobs);
      if (blobs.length < images.length) {
        setUploadError(`Couldn't read ${images.length - blobs.length} of those images.`);
      }
    },
    [onUpload],
  );

  return (
    <div className="space-y-4">
      <div
        className="relative overflow-hidden rounded-2xl border border-border-strong bg-surface"
        style={{ aspectRatio: "4 / 3" }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        />

        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 px-6 text-center backdrop-blur-sm">
            {state === "idle" && (
              <>
                <button
                  onClick={() => startCamera()}
                  className="whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_8px_20px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                  }}
                >
                  Turn on your camera
                </button>
                <p className="max-w-sm text-xs text-muted">
                  Photos stay in this browser tab. Nothing is uploaded.
                </p>
              </>
            )}
            {state === "starting" && <p className="text-xs text-muted">Waiting for camera…</p>}
            {(state === "denied" || state === "busy") && (
              <div className="max-w-sm space-y-3">
                <p className="text-sm text-foreground">
                  {state === "denied"
                    ? "Camera access was blocked. Allow it and try again."
                    : "That camera couldn't start — it may be in use by another app."}
                </p>
                <button
                  onClick={() => startCamera(deviceId)}
                  className="rounded-full border border-border-strong px-5 py-2 text-xs font-medium hover:bg-surface-raised"
                >
                  Try again
                </button>
              </div>
            )}
            {state === "unsupported" && (
              <p className="max-w-sm text-sm text-foreground">
                This browser doesn&apos;t support camera access — you can still upload photos below.
              </p>
            )}
          </div>
        )}

        {state === "running" && captured > 0 && (
          <span className="absolute right-3 top-3 rounded-full bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted backdrop-blur-sm">
            {captured} captured
          </span>
        )}
      </div>

      {state === "running" && (
        <div className="space-y-3">
          <button
            onPointerDown={beginBurst}
            onPointerUp={endBurst}
            onPointerCancel={endBurst}
            onPointerLeave={endBurst}
            className="w-full select-none rounded-full px-5 py-3.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform active:scale-[0.99]"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
              touchAction: "none",
            }}
          >
            Hold for burst images
          </button>
          {/* The button says what it does; the line under it says where the
              photos land, so the target group is still unambiguous. */}
          <p className="text-center text-xs text-muted">
            Tap for a single photo. Both go into{" "}
            <span className="font-medium text-foreground">&ldquo;{targetName}&rdquo;</span>. Move
            around between shots — varied angles and lighting are what make it reliable.
          </p>

          {hasLabels && cameras.length > 1 && (
            <select
              value={deviceId}
              onChange={(e) => startCamera(e.target.value)}
              aria-label="Camera"
              className="w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
            >
              {cameras.map((cam, i) => (
                <option key={cam.deviceId} value={cam.deviceId}>
                  {cam.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingestFiles(e.dataTransfer.files);
        }}
        className="rounded-2xl border border-dashed p-5 text-center transition-colors"
        style={{
          borderColor: dragging ? "var(--accent)" : "var(--border-strong)",
          background: dragging ? "var(--surface-raised)" : "transparent",
        }}
      >
        <p className="text-sm text-foreground">
          Drop photos here, or{" "}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="font-medium text-accent underline underline-offset-2"
          >
            choose files
          </button>
        </p>
        <p className="mt-1 text-xs text-muted">
          They go into &ldquo;{targetName}&rdquo; too.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void ingestFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploadError && <p className="mt-2 text-xs text-muted">{uploadError}</p>}
      </div>
    </div>
  );
}
