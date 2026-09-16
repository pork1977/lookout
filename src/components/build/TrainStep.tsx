"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyCameraError, openCameraStream } from "@/lib/cameraStream";
import { drawFrameForInference } from "@/lib/imageCapture";
import {
  embedBlob,
  embedCanvas,
  loadExtractor,
  predict,
  trainHead,
  type EpochProgress,
  type TrainedHead,
  type TrainingSample,
} from "@/lib/trainer";
import ProgressBar from "./ProgressBar";
import type { DetectorClass } from "./types";

type Phase = "idle" | "loading-model" | "embedding" | "training" | "trained" | "error";

/** Roughly eight predictions a second, smooth to read, cheap to run. */
const PREDICT_INTERVAL_MS = 120;

export default function TrainStep({
  classes,
  head,
  onTrained,
  onBack,
  onContinue,
}: {
  classes: DetectorClass[];
  /** Owned by the wizard, because the triggers step needs it after this one unmounts. */
  head: TrainedHead | null;
  onTrained: (head: TrainedHead) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  // Coming back to this step with a model already trained should show it, not
  // offer to start over.
  const [phase, setPhase] = useState<Phase>(head ? "trained" : "idle");
  const [prepared, setPrepared] = useState({ done: 0, total: 0 });
  const [epoch, setEpoch] = useState<EpochProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [cameraState, setCameraState] = useState<"idle" | "starting" | "running" | "denied" | "busy">(
    "idle",
  );
  const [scores, setScores] = useState<number[] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  // Embeddings are keyed by example id so a retrain after adding a few photos
  // only pays for the new ones, the whole point of freezing the extractor.
  const embeddingCacheRef = useRef<Map<string, Float32Array>>(new Map());

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Only the camera is torn down here. The trained head deliberately survives
  // this component: leaving for the triggers step unmounts it, and disposing
  // the model on the way out would hand the next step an empty tensor.
  useEffect(() => () => stopCamera(), [stopCamera]);

  const train = useCallback(async () => {
    setError(null);
    setEpoch(null);
    try {
      setPhase("loading-model");
      await loadExtractor();

      setPhase("embedding");
      const cache = embeddingCacheRef.current;
      const samples: TrainingSample[] = [];
      const total = classes.reduce((n, c) => n + c.examples.length, 0);
      setPrepared({ done: 0, total });

      let done = 0;
      for (const [classIndex, cls] of classes.entries()) {
        for (const example of cls.examples) {
          let embedding = cache.get(example.id);
          if (!embedding) {
            embedding = await embedBlob(example.blob);
            cache.set(example.id, embedding);
          }
          samples.push({ embedding, classIndex });
          done += 1;
          setPrepared({ done, total });
        }
      }

      setPhase("training");
      const trained = await trainHead(
        samples,
        classes.map((c) => c.id),
        setEpoch,
      );
      // The wizard owns the head, and disposes whichever one this replaces.
      onTrained(trained);
      setPhase("trained");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Training failed.");
      setPhase("error");
    }
  }, [classes, onTrained]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    setCameraState("starting");
    try {
      const stream = await openCameraStream(undefined, { facingMode: "user" });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("running");
    } catch (err) {
      setCameraState(classifyCameraError(err));
    }
  }, []);

  // The prediction loop. Runs only while there's a trained head and a live
  // stream, and skips a tick rather than queueing when one is still in flight.
  useEffect(() => {
    if (cameraState !== "running" || !head) return;

    if (!workCanvasRef.current) workCanvasRef.current = document.createElement("canvas");
    const canvas = workCanvasRef.current;
    let cancelled = false;

    timerRef.current = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busyRef.current) return;
      busyRef.current = true;
      try {
        // Same transform the training photos were stored with, mirrored and
        // centre-cropped, which is the whole reason this goes through the
        // shared helper rather than reading the video directly.
        drawFrameForInference(video, canvas);
        const embedding = await embedCanvas(canvas);
        const probabilities = await predict(head, embedding);
        if (!cancelled) setScores(probabilities);
      } catch {
        /* a dropped frame isn't worth tearing the loop down */
      } finally {
        busyRef.current = false;
      }
    }, PREDICT_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [cameraState, head]);

  const totalExamples = classes.reduce((n, c) => n + c.examples.length, 0);
  const leader = scores ? scores.indexOf(Math.max(...scores)) : -1;

  return (
    <div className="space-y-5">
      {phase === "idle" && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Train your detector</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Your {totalExamples} photos run once through a pretrained vision model to turn each
            into a compact fingerprint, then a small classifier learns to tell your groups apart
            from those. It all happens in this tab, with no upload and no queue, and it takes seconds.
          </p>
          <button
            onClick={train}
            disabled={totalExamples === 0}
            className="mt-5 rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
            }}
          >
            Start training
          </button>
          {/* Reachable now that the step chips navigate directly. Better to say
              what's missing than to start and fail on an empty set. */}
          {totalExamples === 0 && (
            <p className="mt-2 text-xs text-muted">
              No photos yet. Add some on the Examples step first.
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            The vision model is a one-off download of roughly 14&nbsp;MB, then cached.
          </p>
        </div>
      )}

      {(phase === "loading-model" || phase === "embedding" || phase === "training") && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm font-medium text-foreground">
            {phase === "loading-model" && "Loading the vision model…"}
            {phase === "embedding" && `Reading your photos: ${prepared.done} of ${prepared.total}`}
            {phase === "training" &&
              (epoch
                ? `Training, pass ${epoch.epoch} of ${epoch.totalEpochs}`
                : "Training…")}
          </p>
          <div className="mt-3">
            {/* Downloading a model has nothing honest to count, so it sweeps
                rather than showing an invented percentage. */}
            <ProgressBar
              indeterminate={phase === "loading-model" || (phase === "training" && !epoch)}
              value={
                phase === "embedding"
                  ? prepared.total
                    ? prepared.done / prepared.total
                    : 0
                  : epoch
                    ? epoch.epoch / epoch.totalEpochs
                    : 0
              }
            />
          </div>
          {phase === "training" && epoch && (
            <p className="mt-2 font-mono text-xs text-muted">
              accuracy {Math.round(epoch.accuracy * 100)}% · loss {epoch.loss.toFixed(3)}
            </p>
          )}
          {/* TensorFlow.js yields between batches through requestAnimationFrame,
              which browsers stop delivering to a hidden tab, so training pauses
              if you switch away, and picks up again when you come back. Saying so
              beats looking frozen. */}
          <p className="mt-2 text-xs text-muted">
            Keep this tab in front, training pauses if you switch away, and resumes when you
            come back.
          </p>
        </div>
      )}

      {phase === "error" && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm text-foreground">{error}</p>
          <button
            onClick={train}
            className="mt-4 rounded-full border border-border-strong px-5 py-2 text-xs font-medium hover:bg-surface-raised"
          >
            Try again
          </button>
        </div>
      )}

      {phase === "trained" && head && (
        <>
          <div className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-sm font-semibold text-foreground">
              Trained on {totalExamples} photos
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              It got {Math.round(head.finalAccuracy * 100)}% right on the photos it learned from.
              That number always flatters, it&apos;s the real test below that tells you anything.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
            <div
              className="relative overflow-hidden rounded-2xl border border-border-strong bg-surface"
              style={{ aspectRatio: "1 / 1" }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
              />
              {cameraState !== "running" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 px-6 text-center backdrop-blur-sm">
                  {cameraState === "idle" && (
                    <>
                      <button
                        onClick={startCamera}
                        className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_8px_20px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
                        style={{
                          backgroundImage:
                            "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                        }}
                      >
                        Test it on your camera
                      </button>
                      <p className="max-w-sm text-xs text-muted">
                        Point it at the thing you trained it on and watch the bars move.
                      </p>
                    </>
                  )}
                  {cameraState === "starting" && (
                    <p className="text-xs text-muted">Waiting for camera…</p>
                  )}
                  {(cameraState === "denied" || cameraState === "busy") && (
                    <div className="max-w-sm space-y-3">
                      <p className="text-sm text-foreground">
                        {cameraState === "denied"
                          ? "Camera access was blocked. Allow it and try again."
                          : "That camera couldn't start, it may be in use by another app."}
                      </p>
                      <button
                        onClick={startCamera}
                        className="rounded-full border border-border-strong px-5 py-2 text-xs font-medium hover:bg-surface-raised"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Live confidence
              </h3>
              <div className="mt-4 space-y-3">
                {classes.map((cls, i) => {
                  const score = scores?.[i] ?? 0;
                  const isLeader = i === leader && !!scores;
                  return (
                    <div key={cls.id}>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="truncate text-sm"
                          style={{
                            color: isLeader ? "var(--accent)" : "var(--foreground)",
                            fontWeight: isLeader ? 600 : 400,
                          }}
                        >
                          {cls.name || "Untitled group"}
                        </span>
                        <span className="shrink-0 font-mono text-xs text-muted">
                          {Math.round(score * 100)}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${score * 100}%`,
                            background: isLeader
                              ? "linear-gradient(90deg, var(--accent), var(--accent-strong))"
                              : "var(--border-strong)",
                            boxShadow: isLeader ? "0 0 14px -2px var(--glow)" : undefined,
                            // Short and eased: long enough to read as movement,
                            // short enough to still feel live at 8 frames a second.
                            transition: "width 130ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms ease",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {!scores && cameraState === "running" && (
                <p className="mt-4 text-xs text-muted">Reading the first frames…</p>
              )}
              <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted">
                Weak spot? Go back to Examples, add photos of the case it gets wrong, and train
                again, the photos it has already seen are cached, so a retrain only pays for the
                new ones.
              </p>
            </div>
          </div>
        </>
      )}

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="rounded-full border border-border-strong px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            Back
          </button>
          <button
            onClick={onContinue}
            disabled={!head}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
            }}
          >
            Set up triggers
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {head
            ? "Next: decide what happens when it sees something, speak, notify, banner, Slack, Discord, webhook or email."
            : "Train it first, then you can decide what happens when it sees something."}
        </p>
      </div>
    </div>
  );
}
