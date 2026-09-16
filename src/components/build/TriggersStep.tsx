"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyCameraError, openCameraStream } from "@/lib/cameraStream";
import { drawFrameForInference } from "@/lib/imageCapture";
import { embedCanvas, predict, type TrainedHead } from "@/lib/trainer";
import {
  DEFAULT_RULE,
  TriggerEngine,
  type CombineRule,
  type TriggerRule,
} from "@/lib/triggerEngine";
import {
  DEFAULT_SPEECH,
  dispatch,
  notificationPermission,
  notify,
  pickDefaultVoice,
  renderMessage,
  requestNotificationPermission,
  speak,
  speechSupported,
  subscribeToVoices,
  type ClientActionId,
  type ServerActionId,
  type SpeechOptions,
} from "@/lib/triggerActions";
import ProgressBar from "./ProgressBar";
import type { DetectorClass } from "./types";

const PREDICT_INTERVAL_MS = 120;

const CLIENT_ACTIONS: Array<{ id: ClientActionId; label: string; blurb: string }> = [
  { id: "speak", label: "Say it out loud", blurb: "Web Speech, instant, works offline" },
  { id: "banner", label: "Show a banner", blurb: "On this page, instant" },
  { id: "notify", label: "Browser notification", blurb: "Works while this tab is in the background" },
];

const SERVER_ACTIONS: Array<{ id: ServerActionId; label: string; placeholder: string }> = [
  { id: "slack", label: "Slack", placeholder: "https://hooks.slack.com/services/…" },
  { id: "discord", label: "Discord", placeholder: "https://discord.com/api/webhooks/…" },
  { id: "webhook", label: "Any webhook", placeholder: "https://example.com/hook" },
  { id: "email", label: "Email", placeholder: "you@example.com" },
];

export default function TriggersStep({
  classes,
  head,
  detectorName,
  onBack,
}: {
  classes: DetectorClass[];
  head: TrainedHead | null;
  detectorName: string;
  onBack: () => void;
}) {
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [rule, setRule] = useState<TriggerRule>({ ...DEFAULT_RULE, classId: classes[0]?.id ?? "" });
  const [template, setTemplate] = useState("Lookout saw {what} ({confidence})");
  const [clientActions, setClientActions] = useState<Set<ClientActionId>>(new Set(["banner"]));
  const [serverTargets, setServerTargets] = useState<Record<string, string>>({});
  const [emailAvailable, setEmailAvailable] = useState(true);

  const [armed, setArmed] = useState(false);
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "running" | "denied" | "busy">("idle");
  const [engineState, setEngineState] = useState<{ held: number; condition: boolean; cooling: boolean } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">("default");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speech, setSpeech] = useState<SpeechOptions>({ ...DEFAULT_SPEECH });
  const [log, setLog] = useState<Array<{ at: string; text: string; error?: string }>>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const engineRef = useRef<TriggerEngine | null>(null);
  const bannerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Notification.permission has no synchronous value that is safe to read
    // during SSR and no change event to subscribe to, so reading it once on
    // mount really is the only option here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotifyPermission(notificationPermission());
  }, []);

  useEffect(() => subscribeToVoices(setVoices), []);

  useEffect(() => {
    fetch("/api/dispatch")
      .then((r) => r.json())
      .then((d) => setEmailAvailable(!!d?.email))
      .catch(() => setEmailAvailable(false));
  }, []);

  const classIndex = useMemo(() => classes.findIndex((c) => c.id === classId), [classes, classId]);

  const stopCamera = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stopCamera();
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    },
    [stopCamera],
  );

  const fire = useCallback(
    async (confidence: number) => {
      const className = classes[classIndex]?.name || "something";
      const message = renderMessage(template, className, confidence);
      const at = new Date().toLocaleTimeString();
      setLog((prev) => [{ at, text: message }, ...prev].slice(0, 8));

      if (clientActions.has("speak")) speak(message, speech);
      if (clientActions.has("notify")) notify(detectorName || "Lookout", message);
      if (clientActions.has("banner")) {
        setBanner(message);
        if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
        bannerTimerRef.current = window.setTimeout(() => setBanner(null), 6000);
      }

      for (const [action, target] of Object.entries(serverTargets)) {
        if (!target.trim()) continue;
        const result = await dispatch({
          action: action as ServerActionId,
          target: target.trim(),
          message,
          detectorName,
          className,
          confidence,
        });
        if (!result.ok) {
          setLog((prev) => [{ at, text: `${action} failed`, error: result.error }, ...prev].slice(0, 8));
        }
      }
    },
    [classes, classIndex, template, clientActions, serverTargets, detectorName, speech],
  );

  // The prediction loop calls fireRef.current, never `fire` directly, so `fire`
  // is free to be rebuilt whenever its inputs change — including the voice
  // settings — without disturbing the loop or the dwell clock.
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  }, [fire]);

  const startCamera = useCallback(async () => {
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

  // Keep the engine's rule current without rebuilding it, so changing a dwell
  // mid-watch doesn't throw away the time already accumulated.
  useEffect(() => {
    engineRef.current?.setRule({ ...rule, classId });
  }, [rule, classId]);

  useEffect(() => {
    if (!armed || cameraState !== "running" || !head || classIndex < 0) return;

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    const engine = new TriggerEngine({ ...rule, classId });
    engineRef.current = engine;
    let cancelled = false;

    timerRef.current = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || busyRef.current) return;
      busyRef.current = true;
      try {
        drawFrameForInference(video, canvas);
        const scores = await predict(head, await embedCanvas(canvas));
        if (cancelled) return;
        // One camera here — the same engine takes a reading per camera once a
        // detector can watch several at once.
        const state = engine.update([{ cameraId: "primary", score: scores[classIndex] }], Date.now());
        setEngineState({ held: state.heldMs, condition: state.condition, cooling: state.cooling });
        if (state.fired) void fireRef.current(scores[classIndex]);
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
      engineRef.current = null;
    };
    // `rule` is applied through setRule above; re-running here would restart the
    // dwell clock on every keystroke in the settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, cameraState, head, classIndex, classId]);

  const activeClassName = classes[classIndex]?.name || "Untitled group";
  const previewMessage = renderMessage(template, activeClassName, 0.92);

  const dwellProgress = engineState
    ? Math.min(1, engineState.held / Math.max(1, rule.dwellSeconds * 1000))
    : 0;

  if (!head) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Train it first</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Triggers watch a trained detector, so there needs to be one. Go back a step and train,
            then come here to decide what happens when it sees something.
          </p>
        </div>
        <Footer onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-sm font-semibold text-foreground">When it sees…</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {classes.map((cls) => {
                const selected = cls.id === classId;
                return (
                  <button
                    key={cls.id}
                    onClick={() => {
                      setClassId(cls.id);
                      setRule((r) => ({ ...r, classId: cls.id }));
                    }}
                    className="rounded-full border px-4 py-2 text-sm transition-colors"
                    style={{
                      borderColor: selected ? "var(--accent)" : "var(--border-strong)",
                      background: selected ? "var(--surface-raised)" : "transparent",
                      color: selected ? "var(--accent)" : "var(--foreground)",
                    }}
                  >
                    {cls.name || "Untitled group"}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <NumberField
                label="…for at least"
                suffix="seconds"
                value={rule.dwellSeconds}
                min={0}
                max={3600}
                onChange={(dwellSeconds) => setRule((r) => ({ ...r, dwellSeconds }))}
                hint="Short for “someone walked up behind me”. Minutes for “I've left my desk”."
              />
              <NumberField
                label="Then wait before firing again"
                suffix="seconds"
                value={rule.cooldownSeconds}
                min={0}
                max={86400}
                onChange={(cooldownSeconds) => setRule((r) => ({ ...r, cooldownSeconds }))}
                hint="Without this you get one alert per frame for as long as it holds."
              />
            </div>

            <div className="mt-6">
              <span className="text-xs font-semibold text-foreground">With several cameras</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["any", "all"] as CombineRule[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setRule((r) => ({ ...r, combine: mode }))}
                    className="rounded-full border px-3.5 py-1.5 text-xs transition-colors"
                    style={{
                      borderColor: rule.combine === mode ? "var(--accent)" : "var(--border-strong)",
                      color: rule.combine === mode ? "var(--accent)" : "var(--foreground)",
                    }}
                  >
                    {mode === "any" ? "Any camera sees it" : "Every camera agrees"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                {rule.combine === "any"
                  ? "Right for “something is there”, and for cameras watching different places — a camera that can't see the dog isn't evidence there's no dog."
                  : "Right for “nothing is there”, like “I've left my desk” — one camera still seeing you proves the condition false. Cameras that can only half-see abstain rather than blocking."}
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="text-sm font-semibold text-foreground">Then do this</h2>

            <div className="mt-4 space-y-2">
              {CLIENT_ACTIONS.map((action) => {
                const on = clientActions.has(action.id);
                return (
                  <label
                    key={action.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-surface-raised"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={async (e) => {
                        // Captured before the await: this is a controlled input,
                        // so React repaints it back to its state value while the
                        // permission prompt is open, and reading e.target.checked
                        // afterwards always came back false — which is why the
                        // box never stayed ticked.
                        const wanted = e.target.checked;
                        if (wanted && action.id === "notify") {
                          const permission = await requestNotificationPermission();
                          // Ticking a box that can't do anything is worse than
                          // not ticking it.
                          if (permission !== "granted") {
                            setNotifyPermission(permission);
                            return;
                          }
                          setNotifyPermission(permission);
                        }
                        setClientActions((prev) => {
                          const next = new Set(prev);
                          if (wanted) next.add(action.id);
                          else next.delete(action.id);
                          return next;
                        });
                      }}
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">{action.label}</span>
                      <span className="block text-xs text-muted">
                        {action.blurb}
                        {action.id === "notify" && notifyPermission === "denied" && (
                          <span className="text-foreground"> · blocked in this browser</span>
                        )}
                        {action.id === "notify" && notifyPermission === "unsupported" && (
                          <span className="text-foreground"> · not supported here</span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-5 space-y-3 border-t border-border pt-5">
              {SERVER_ACTIONS.map((action) => {
                const disabled = action.id === "email" && !emailAvailable;
                return (
                  <div key={action.id}>
                    <label className="text-xs font-medium text-foreground">{action.label}</label>
                    <input
                      value={serverTargets[action.id] ?? ""}
                      disabled={disabled}
                      onChange={(e) =>
                        setServerTargets((prev) => ({ ...prev, [action.id]: e.target.value }))
                      }
                      placeholder={disabled ? "Needs RESEND_API_KEY on the server" : action.placeholder}
                      className="mt-1.5 w-full rounded-xl border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                );
              })}
              <p className="text-xs leading-relaxed text-muted">
                These go through the server, so your webhook URL never sits in the page. Only
                https, and addresses on private networks are refused.
              </p>
            </div>

            <div className="mt-5 border-t border-border pt-5">
              <label className="text-xs font-medium text-foreground">Message</label>
              {/* A textarea, because this same field is the body of an email as
                  well as a line of speech, and drafting a few paragraphs in a
                  single-line input is miserable. resize-y keeps the drag handle. */}
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={3}
                className="mt-1.5 w-full resize-y rounded-xl border border-border-strong bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors focus:border-accent"
              />
              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex gap-2">
                  <dt className="shrink-0">
                    <code className="rounded bg-surface-raised px-1 py-0.5 text-accent">
                      {"{what}"}
                    </code>
                  </dt>
                  <dd className="text-muted">
                    the group it saw &mdash; right now that is{" "}
                    <span className="text-foreground">
                      &ldquo;{activeClassName}&rdquo;
                    </span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0">
                    <code className="rounded bg-surface-raised px-1 py-0.5 text-accent">
                      {"{confidence}"}
                    </code>
                  </dt>
                  <dd className="text-muted">
                    how sure it was, as a percentage &mdash;{" "}
                    <span className="text-foreground">&ldquo;92%&rdquo;</span>
                  </dd>
                </div>
              </dl>
              {/* The brackets in the default are just punctuation, which was not
                  obvious from the field alone. A worked example says it better
                  than a sentence can. */}
              <p className="mt-3 rounded-xl bg-surface-raised px-3 py-2 text-xs text-muted">
                Reads out as:{" "}
                <span className="text-foreground">&ldquo;{previewMessage}&rdquo;</span>
              </p>
              <p className="mt-1.5 text-xs text-muted">
                The round brackets are ordinary text &mdash; delete them if you would rather it
                just said &ldquo;{activeClassName} 92%&rdquo;.
              </p>
            </div>

            {clientActions.has("speak") && speechSupported() && (
              <div className="mt-5 border-t border-border pt-5">
                <span className="text-xs font-medium text-foreground">Voice</span>
                <select
                  value={speech.voiceURI ?? pickDefaultVoice(voices)?.voiceURI ?? ""}
                  onChange={(e) => setSpeech((prev) => ({ ...prev, voiceURI: e.target.value }))}
                  className="mt-1.5 w-full rounded-xl border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                >
                  {voices.length === 0 && <option value="">Loading voices…</option>}
                  {voices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang}){voice.localService ? "" : " · cloud"}
                    </option>
                  ))}
                </select>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <RangeField
                    label="Speed"
                    value={speech.rate ?? 1}
                    min={0.6}
                    max={1.4}
                    onChange={(rate) => setSpeech((prev) => ({ ...prev, rate }))}
                  />
                  <RangeField
                    label="Pitch"
                    value={speech.pitch ?? 1}
                    min={0.6}
                    max={1.4}
                    onChange={(pitch) => setSpeech((prev) => ({ ...prev, pitch }))}
                  />
                </div>
                <button
                  onClick={() => speak(previewMessage, speech)}
                  className="mt-3 rounded-full border border-border-strong px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  Hear it
                </button>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  Voices come from your own device and browser, with no service involved. The ones
                  marked cloud usually sound the most natural.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24">
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
                  <button
                    onClick={startCamera}
                    className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_8px_20px_-8px_var(--glow)] transition-transform hover:scale-[1.03]"
                    style={{
                      backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))",
                    }}
                  >
                    Turn on your camera
                  </button>
                )}
                {cameraState === "starting" && <p className="text-xs text-muted">Waiting for camera…</p>}
                {(cameraState === "denied" || cameraState === "busy") && (
                  <p className="max-w-sm text-sm text-foreground">
                    {cameraState === "denied"
                      ? "Camera access was blocked."
                      : "That camera couldn't start."}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {armed ? "Watching" : "Not watching"}
              </span>
              <button
                onClick={() => setArmed((v) => !v)}
                disabled={cameraState !== "running"}
                className="rounded-full border border-border-strong px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
              >
                {armed ? "Stop" : "Start watching"}
              </button>
            </div>

            <div className="mt-4">
              <ProgressBar value={dwellProgress} active={!!engineState?.condition} />
              <p className="mt-2 text-xs text-muted">
                {!armed
                  ? "Set your conditions, then start watching."
                  : engineState?.cooling
                    ? "Just fired — holding off for the cooldown."
                    : engineState?.condition
                      ? `Holding — ${(engineState.held / 1000).toFixed(1)}s of ${rule.dwellSeconds}s`
                      : "Waiting to see it."}
              </p>
            </div>

            {log.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
                {log.map((entry, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-mono text-muted">{entry.at}</span>{" "}
                    <span className={entry.error ? "text-foreground" : "text-accent"}>
                      {entry.text}
                    </span>
                    {entry.error && <span className="block text-muted">{entry.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Footer onBack={onBack} />
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted">{label}</label>
        <span className="font-mono text-xs text-muted">{value.toFixed(2)}&times;</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--accent)]"
      />
    </div>
  );
}

function NumberField({
  label,
  suffix,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
          }}
          className="w-24 rounded-xl border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
        />
        <span className="text-xs text-muted">{suffix}</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>
    </div>
  );
}

function Footer({ onBack }: { onBack: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-full border border-border-strong px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
        >
          Back
        </button>
        <div className="flex items-center gap-2 rounded-full border border-dashed border-border-strong px-4 py-2">
          <span className="text-sm font-medium text-muted">Deploy</span>
          <span className="rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            Being built
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Next: saving detectors to an account, a shareable run link, and a standalone offline file.
      </p>
    </div>
  );
}
