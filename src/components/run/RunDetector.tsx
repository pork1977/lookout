"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { drawFrameForInference } from "@/lib/imageCapture";
import { loadSharedDetector, type SharedDetector } from "@/lib/shareDetector";
import { disposeHead, loadExtractor, readFrame } from "@/lib/trainer";
import {
  notificationPermission,
  notify,
  renderMessage,
  requestNotificationPermission,
  speak,
  speechSupported,
  type ClientActionId,
} from "@/lib/triggerActions";
import { TriggerEngine } from "@/lib/triggerEngine";
import AttentionOverlay, { AttentionToggle, useAttention } from "@/components/build/AttentionOverlay";
import ProgressBar from "@/components/build/ProgressBar";
import WatchTile, { type WatchStatus } from "@/components/build/WatchTile";

const PREDICT_INTERVAL_MS = 120;
const CAMERA_ID = "run-camera";
/**
 * A shared link's settings come from someone else. Without a floor, a share
 * with no cooldown and notifications ticked would fire a notification every
 * frame on the viewer's device.
 */
const MIN_SHARED_COOLDOWN_SECONDS = 5;

type Phase = "loading" | "ready" | "missing" | "error";

const ACTIONS: Array<{ id: ClientActionId; label: string }> = [
  { id: "speak", label: "Say it out loud" },
  { id: "banner", label: "Show a banner" },
  { id: "notify", label: "Browser notification" },
];

/**
 * The page behind a shared link. It can only watch and react on this device:
 * there is no route from here to /api/dispatch, and the actions it offers are
 * a fixed list of on-device ones, whatever the share's settings say.
 */
export default function RunDetector({ slug }: { slug: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [detector, setDetector] = useState<SharedDetector | null>(null);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [armed, setArmed] = useState(false);
  const [scores, setScores] = useState<number[] | null>(null);
  const [maps, setMaps] = useState<Float32Array[] | null>(null);
  const [watchScore, setWatchScore] = useState<number | null>(null);
  const [engineState, setEngineState] = useState<{ held: number; condition: boolean; cooling: boolean } | null>(null);
  const [actions, setActions] = useState<Set<ClientActionId>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ at: string; text: string }>>([]);

  const attention = useAttention(phase === "ready");
  const attentionOnRef = useRef(attention.on);
  useEffect(() => {
    attentionOnRef.current = attention.on;
  }, [attention.on]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const busyRef = useRef(false);
  const engineRef = useRef<TriggerEngine | null>(null);
  const armedRef = useRef(false);
  const bannerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: SharedDetector | null = null;
    (async () => {
      try {
        // The extractor first: it sets up the GPU backend the shared head then
        // loads onto, and it is the slow part worth showing progress for.
        await loadExtractor();
        loaded = await loadSharedDetector(slug);
        if (cancelled) {
          disposeHead(loaded?.head ?? null);
          return;
        }
        if (!loaded) {
          setPhase("missing");
          return;
        }
        loaded.settings.rule.cooldownSeconds = Math.max(
          MIN_SHARED_COOLDOWN_SECONDS,
          loaded.settings.rule.cooldownSeconds,
        );
        setDetector(loaded);
        setActions(new Set(loaded.settings.clientActions));
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Something went wrong loading this detector.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
      disposeHead(loaded?.head ?? null);
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    };
  }, [slug]);

  const watchIndex = detector
    ? Math.max(0, detector.groups.findIndex((g) => g.id === detector.settings.rule.classId))
    : 0;
  const watched = detector?.groups[watchIndex];

  const fireRef = useRef<(confidence: number) => void>(() => {});
  useEffect(() => {
    fireRef.current = (confidence: number) => {
      if (!detector) return;
      const message = renderMessage(
        detector.settings.template,
        watched?.name || "something",
        confidence,
      );
      setLog((prev) => [{ at: new Date().toLocaleTimeString(), text: message }, ...prev].slice(0, 8));
      if (actions.has("speak")) speak(message, detector.settings.speech);
      if (actions.has("notify")) notify(detector.name || "Lookout", message);
      if (actions.has("banner")) {
        setBanner(message);
        if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = window.setTimeout(() => setBanner(null), 6000);
      }
    };
  }, [detector, watched, actions]);

  const registerVideo = useCallback((_uid: string, video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  const onStatus = useCallback((_uid: string, status: WatchStatus) => {
    setCameraRunning(status === "running");
  }, []);

  useEffect(() => {
    if (!detector || !cameraRunning) return;
    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    const head = detector.head;
    let cancelled = false;

    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busyRef.current) return;
      busyRef.current = true;
      try {
        drawFrameForInference(video, canvas);
        const reading = await readFrame(head, canvas, attentionOnRef.current);
        if (cancelled) return;
        setScores(reading.probabilities);
        setMaps(reading.maps);
        const engine = engineRef.current;
        if (engine && armedRef.current) {
          const state = engine.update(
            [{ cameraId: CAMERA_ID, score: reading.probabilities[watchIndex] }],
            Date.now(),
          );
          setWatchScore(state.scores[CAMERA_ID] ?? null);
          setEngineState({ held: state.heldMs, condition: state.condition, cooling: state.cooling });
          if (state.fired) fireRef.current(reading.probabilities[watchIndex]);
        }
      } catch {
        /* a dropped frame isn't worth tearing the loop down */
      } finally {
        busyRef.current = false;
      }
    }, PREDICT_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detector, cameraRunning, watchIndex]);

  const toggleArmed = useCallback(async () => {
    if (!detector) return;
    if (armed) {
      armedRef.current = false;
      engineRef.current = null;
      setArmed(false);
      setEngineState(null);
      setWatchScore(null);
      return;
    }
    if (actions.has("notify") && notificationPermission() === "default") {
      // Asked here because it needs a click to be allowed at all.
      await requestNotificationPermission();
    }
    engineRef.current = new TriggerEngine(detector.settings.rule);
    armedRef.current = true;
    setArmed(true);
  }, [armed, actions, detector]);

  if (phase === "loading") {
    return (
      <Shell>
        <div className="mx-auto max-w-lg rounded-2xl border border-border bg-surface p-6">
          <h1 className="text-sm font-semibold text-foreground">Loading a shared detector</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Downloading the vision model it runs on. That&apos;s about 14MB the first time, and
            everything after it happens on this device.
          </p>
          <div className="mt-5">
            <ProgressBar indeterminate />
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "missing" || phase === "error" || !detector) {
    return (
      <Shell>
        <div className="mx-auto max-w-lg rounded-2xl border border-border bg-surface p-6">
          <h1 className="text-sm font-semibold text-foreground">
            {phase === "missing" ? "This link isn't sharing anything" : "This detector couldn't load"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {phase === "missing"
              ? "Whoever made it may have stopped sharing it, or the link got cut short when it was copied."
              : error}
          </p>
          <Link
            href="/build"
            className="mt-5 inline-block rounded-full border border-border-strong px-4 py-2 text-xs font-medium text-foreground hover:bg-surface-raised"
          >
            Build your own
          </Link>
        </div>
      </Shell>
    );
  }

  const leader = scores ? scores.indexOf(Math.max(...scores)) : -1;
  const dwellProgress = engineState
    ? Math.min(1, engineState.held / Math.max(1, detector.settings.rule.dwellSeconds * 1000))
    : 0;

  return (
    <Shell>
      {banner && (
        <div
          className="animate-toast-in glow-ring fixed left-1/2 top-6 z-50 max-w-[min(90vw,32rem)] rounded-2xl border border-border-strong bg-surface px-5 py-4 text-sm font-medium text-foreground shadow-2xl"
          style={{ transform: "translateX(-50%)" }}
          role="status"
          aria-live="polite"
        >
          {banner}
        </div>
      )}

      <header className="mb-8">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent">
          Shared detector
        </span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {detector.name || "Untitled detector"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Built with Lookout and running entirely on this device. Your camera feed never leaves it.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
        <div className="relative">
          <WatchTile
            uid={CAMERA_ID}
            label="Camera"
            autoStart={false}
            compact={false}
            score={watchScore}
            seeing={!!engineState?.condition}
            attentionMap={null}
            armed={armed}
            registerVideo={registerVideo}
            onStatus={onStatus}
          />
          {/* Drawn here rather than through the tile, so the overlay follows
              whichever group is winning, the same as on the Train step. */}
          {attention.on && cameraRunning && maps && leader >= 0 && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
              <AttentionOverlay map={maps[leader]} />
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Live confidence
            </h2>
            <div className="mt-4 space-y-3">
              {detector.groups.map((group, i) => {
                const score = scores?.[i] ?? 0;
                const isLeader = i === leader && !!scores;
                return (
                  <div key={group.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-sm"
                        style={{
                          color: isLeader ? "var(--accent)" : "var(--foreground)",
                          fontWeight: isLeader ? 600 : 400,
                        }}
                      >
                        {group.name || "Untitled group"}
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
                          transition: "width 130ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {!cameraRunning && (
              <p className="mt-4 text-xs text-muted">Turn on the camera to see it work.</p>
            )}
            {attention.available && (
              <div className="mt-5 border-t border-border pt-4">
                <AttentionToggle on={attention.on} onToggle={attention.toggle} />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {armed ? "Watching" : "Not watching"}
              </span>
              <button
                onClick={toggleArmed}
                disabled={!cameraRunning}
                className="rounded-full border border-border-strong px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
              >
                {armed ? "Stop" : "Start watching"}
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Reacts when it sees{" "}
              <span className="text-accent">{watched?.name || "Untitled group"}</span> for{" "}
              {detector.settings.rule.dwellSeconds}s, then waits{" "}
              {detector.settings.rule.cooldownSeconds}s before reacting again.
            </p>
            <div className="mt-4">
              <ProgressBar value={dwellProgress} active={!!engineState?.condition} />
              <p className="mt-2 text-xs text-muted">
                {!armed
                  ? "Start watching when you're ready. Keep this tab open and in front."
                  : engineState?.cooling
                    ? "Just fired, holding off for the cooldown."
                    : engineState?.condition
                      ? `Holding, ${(engineState.held / 1000).toFixed(1)}s of ${detector.settings.rule.dwellSeconds}s`
                      : "Waiting to see it."}
              </p>
            </div>

            <div className="mt-4 space-y-1.5 border-t border-border pt-4">
              {ACTIONS.map((action) => {
                const supported = action.id !== "speak" || speechSupported();
                return (
                  <label key={action.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={actions.has(action.id)}
                      disabled={!supported}
                      onChange={(e) => {
                        const wanted = e.target.checked;
                        setActions((prev) => {
                          const next = new Set(prev);
                          if (wanted) next.add(action.id);
                          else next.delete(action.id);
                          return next;
                        });
                      }}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {action.label}
                  </label>
                );
              })}
            </div>

            {log.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
                {log.map((entry, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-mono text-muted">{entry.at}</span>{" "}
                    <span className="text-accent">{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">{children}</div>;
}
