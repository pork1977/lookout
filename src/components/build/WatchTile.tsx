"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { classifyCameraError, openCameraStream } from "@/lib/cameraStream";

export type WatchStatus = "idle" | "starting" | "running" | "denied" | "busy";

/**
 * One camera on the Triggers step. The tile owns its stream and nothing else:
 * the prediction loop lives in the parent, which reads frames from the video
 * element this tile registers, so every camera shares one loop, one engine and
 * one dwell clock.
 */
function WatchTile({
  uid,
  deviceId,
  label,
  autoStart,
  compact,
  score,
  seeing,
  armed,
  onRemove,
  registerVideo,
  onStatus,
}: {
  uid: string;
  deviceId?: string;
  label: string;
  autoStart: boolean;
  compact: boolean;
  /** Smoothed score for the watched group, or null before the first reading. */
  score: number | null;
  seeing: boolean;
  armed: boolean;
  onRemove?: (uid: string) => void;
  registerVideo: (uid: string, video: HTMLVideoElement | null) => void;
  onStatus: (uid: string, status: WatchStatus, deviceId?: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const [status, setStatus] = useState<WatchStatus>("idle");

  const report = useCallback(
    (next: WatchStatus, resolvedId?: string) => {
      setStatus(next);
      onStatus(uid, next, resolvedId);
    },
    [onStatus, uid],
  );

  const start = useCallback(async () => {
    const generation = ++generationRef.current;
    report("starting");
    try {
      const stream = await openCameraStream(
        deviceId,
        deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" },
      );
      // Removed, or restarted, while the permission prompt was open.
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      report("running", stream.getVideoTracks()[0]?.getSettings().deviceId);
    } catch (err) {
      if (generation === generationRef.current) report(classifyCameraError(err));
    }
  }, [deviceId, report]);

  useEffect(() => {
    registerVideo(uid, videoRef.current);
    return () => registerVideo(uid, null);
  }, [registerVideo, uid]);

  useEffect(() => {
    // Cameras added from the picker start themselves; the first one waits for
    // a click, so the permission prompt is never a surprise.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (autoStart) void start();
    return () => {
      generationRef.current += 1;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // Starting is a mount-time decision; deviceId never changes for a tile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const percent = score === null ? null : Math.round(score * 100);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border bg-surface transition-[border-color,box-shadow] duration-200"
      style={{
        aspectRatio: "1 / 1",
        borderColor: seeing ? "var(--accent)" : "var(--border-strong)",
        boxShadow: seeing ? "0 0 0 1px var(--accent), 0 0 24px -6px var(--glow)" : undefined,
      }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
      />

      {status === "running" && (
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/55 to-transparent px-3 py-2">
          <span className="truncate text-[11px] font-medium text-white">{label}</span>
          {onRemove && (
            <button
              onClick={() => onRemove(uid)}
              aria-label={`Stop using ${label}`}
              className="shrink-0 rounded-full bg-black/40 px-2 py-0.5 text-xs text-white hover:bg-black/60"
            >
              ×
            </button>
          )}
        </div>
      )}

      {status === "running" && armed && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2.5 pt-5">
          <div className="flex items-center justify-between text-[11px] text-white">
            <span>{seeing ? "Sees it" : percent === null ? "Looking…" : "Not sure yet"}</span>
            <span className="font-mono">{percent === null ? "" : `${percent}%`}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full transition-[width] duration-150"
              style={{
                width: `${percent ?? 0}%`,
                background: "linear-gradient(90deg, var(--accent), var(--accent-strong))",
              }}
            />
          </div>
        </div>
      )}

      {status !== "running" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 px-4 text-center backdrop-blur-sm">
          {status === "idle" && (
            <button
              onClick={start}
              className={`rounded-full font-semibold text-accent-ink shadow-[0_8px_20px_-8px_var(--glow)] transition-transform hover:scale-[1.03] ${
                compact ? "px-3.5 py-1.5 text-xs" : "px-5 py-2.5 text-sm"
              }`}
              style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
            >
              Turn on your camera
            </button>
          )}
          {status === "starting" && <p className="text-xs text-muted">Waiting for camera…</p>}
          {(status === "denied" || status === "busy") && (
            <>
              <p className="max-w-sm text-xs text-foreground">
                {status === "denied"
                  ? "Camera access was blocked."
                  : "That camera couldn't start. It may be in use, or the USB port may be out of bandwidth."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={start}
                  className="rounded-full border border-border-strong px-3 py-1 text-xs text-foreground hover:bg-surface-raised"
                >
                  Try again
                </button>
                {onRemove && (
                  <button
                    onClick={() => onRemove(uid)}
                    className="rounded-full border border-border-strong px-3 py-1 text-xs text-foreground hover:bg-surface-raised"
                  >
                    Remove
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(WatchTile);
