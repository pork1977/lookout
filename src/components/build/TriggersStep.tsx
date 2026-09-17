"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { drawFrameForInference } from "@/lib/imageCapture";
import { readFrame, type TrainedHead } from "@/lib/trainer";
import {
  TriggerEngine,
  type CameraReading,
  type CombineRule,
  type TriggerRule,
} from "@/lib/triggerEngine";
import { useMediaDevices } from "@/lib/useMediaDevices";
import type { TriggerSettings } from "@/lib/triggerSettings";
import {
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
import { AttentionToggle, useAttention } from "./AttentionOverlay";
import ProgressBar from "./ProgressBar";
import type { DetectorClass } from "./types";
import WatchTile, { type WatchStatus } from "./WatchTile";

const PREDICT_INTERVAL_MS = 120;

/**
 * Every camera costs one full MobileNet pass per tick, run one after another,
 * so each extra camera slows every camera down. Three still reacts well inside
 * a second on a laptop GPU; past that the dwell clock starts to feel laggy.
 */
const MAX_WATCH_CAMERAS = 3;

interface WatchCamera {
  uid: string;
  deviceId?: string;
  autoStart: boolean;
}

/** "HD Webcam (046d:085c)" reads fine in a menu but crowds a small tile. */
function shortCameraLabel(label: string | undefined, index: number): string {
  const trimmed = label?.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
  return trimmed || `Camera ${index + 1}`;
}

const CLIENT_ACTIONS: Array<{ id: ClientActionId; label: string; blurb: string }> = [
  { id: "speak", label: "Say it out loud", blurb: "Uses the browser's built-in speech and works offline" },
  { id: "banner", label: "Show a banner", blurb: "Appears at the top of this page" },
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
  settings,
  onSettingsChange,
  onBack,
  onContinue,
}: {
  classes: DetectorClass[];
  head: TrainedHead | null;
  detectorName: string;
  /**
   * Owned by the wizard, so the settings survive leaving this step, save with
   * the detector, and are what the Deploy step shares.
   */
  settings: TriggerSettings;
  onSettingsChange: (update: (previous: TriggerSettings) => TriggerSettings) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  // A saved setting can point at a group that has since been removed.
  const classId = classes.some((c) => c.id === settings.rule.classId)
    ? settings.rule.classId
    : (classes[0]?.id ?? "");
  const rule = settings.rule;
  const template = settings.template;
  const speech = settings.speech;
  const clientActions = useMemo(() => new Set(settings.clientActions), [settings.clientActions]);

  const setRule = useCallback(
    (update: (previous: TriggerRule) => TriggerRule) =>
      onSettingsChange((s) => ({ ...s, rule: update(s.rule) })),
    [onSettingsChange],
  );
  const setClassId = useCallback((id: string) => setRule((r) => ({ ...r, classId: id })), [setRule]);
  const setTemplate = useCallback(
    (next: string) => onSettingsChange((s) => ({ ...s, template: next })),
    [onSettingsChange],
  );
  const setSpeech = useCallback(
    (update: (previous: SpeechOptions) => SpeechOptions) =>
      onSettingsChange((s) => ({ ...s, speech: update(s.speech) })),
    [onSettingsChange],
  );
  const setClientActions = useCallback(
    (update: (previous: Set<ClientActionId>) => Set<ClientActionId>) =>
      onSettingsChange((s) => ({ ...s, clientActions: [...update(new Set(s.clientActions))] })),
    [onSettingsChange],
  );
  const [serverTargets, setServerTargets] = useState<Record<string, string>>({});
  const [emailAvailable, setEmailAvailable] = useState(true);

  const [armed, setArmed] = useState(false);
  const [cameras, setCameras] = useState<WatchCamera[]>([{ uid: "cam-0", autoStart: false }]);
  const [statuses, setStatuses] = useState<Record<string, WatchStatus>>({});
  const [live, setLive] = useState<{
    scores: Record<string, number>;
    seeing: string[];
    maps: Record<string, Float32Array>;
  }>({ scores: {}, seeing: [], maps: {} });
  const attention = useAttention(!!head);
  const attentionOnRef = useRef(attention.on);
  useEffect(() => {
    attentionOnRef.current = attention.on;
  }, [attention.on]);
  const [engineState, setEngineState] = useState<{ held: number; condition: boolean; cooling: boolean } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">("default");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [log, setLog] = useState<Array<{ at: string; text: string; seenBy?: string; error?: string }>>([]);

  const { cameras: devices, hasLabels, refresh: refreshDevices } = useMediaDevices();

  // The loop reads these through refs so adding or removing a camera changes
  // what it reads on the next tick without restarting it, which would reset
  // the dwell clock.
  const videosRef = useRef(new Map<string, HTMLVideoElement>());
  const nextUid = useRef(0);
  const camerasRef = useRef(cameras);
  const statusRef = useRef<Record<string, WatchStatus>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    },
    [],
  );

  const registerVideo = useCallback((uid: string, video: HTMLVideoElement | null) => {
    if (video) videosRef.current.set(uid, video);
    else videosRef.current.delete(uid);
  }, []);

  const onCameraStatus = useCallback(
    (uid: string, status: WatchStatus, resolvedId?: string) => {
      statusRef.current = { ...statusRef.current, [uid]: status };
      setStatuses(statusRef.current);
      if (status !== "running") return;
      // Labels only appear once permission exists, so the picker has nothing
      // to list until the first camera is actually running.
      void refreshDevices();
      if (resolvedId) {
        setCameras((prev) =>
          prev.some((c) => c.uid === uid && c.deviceId !== resolvedId)
            ? prev.map((c) => (c.uid === uid ? { ...c, deviceId: resolvedId } : c))
            : prev,
        );
      }
    },
    [refreshDevices],
  );

  const removeCamera = useCallback((uid: string) => {
    setCameras((prev) => (prev.length > 1 ? prev.filter((c) => c.uid !== uid) : prev));
    const next = { ...statusRef.current };
    delete next[uid];
    statusRef.current = next;
    setStatuses(next);
  }, []);

  const toggleDevice = useCallback(
    (deviceId: string) => {
      const existing = cameras.find((c) => c.deviceId === deviceId);
      if (existing) {
        removeCamera(existing.uid);
        return;
      }
      if (cameras.length >= MAX_WATCH_CAMERAS) return;
      nextUid.current += 1;
      const uid = `cam-${nextUid.current}`;
      setCameras((prev) => [...prev, { uid, deviceId, autoStart: true }]);
    },
    [cameras, removeCamera],
  );

  const labelFor = useCallback(
    (camera: WatchCamera, index: number) =>
      shortCameraLabel(devices.find((d) => d.deviceId === camera.deviceId)?.label, index),
    [devices],
  );

  const fire = useCallback(
    async (confidence: number, seenBy: string[]) => {
      const className = classes[classIndex]?.name || "something";
      const message = renderMessage(template, className, confidence);
      const at = new Date().toLocaleTimeString();
      const current = camerasRef.current;
      const seenByLabel =
        current.length > 1
          ? seenBy
              .map((uid) => {
                const index = current.findIndex((c) => c.uid === uid);
                return index < 0 ? null : labelFor(current[index], index);
              })
              .filter(Boolean)
              .join(", ")
          : undefined;
      setLog((prev) => [{ at, text: message, seenBy: seenByLabel || undefined }, ...prev].slice(0, 8));

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
    [classes, classIndex, template, clientActions, serverTargets, detectorName, speech, labelFor],
  );

  // The prediction loop calls fireRef.current, never `fire` directly, so `fire`
  // is free to be rebuilt whenever its inputs change, including the voice
  // settings, without disturbing the loop or the dwell clock.
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  }, [fire]);

  // Keep the engine's rule current without rebuilding it, so changing a dwell
  // mid-watch doesn't throw away the time already accumulated.
  useEffect(() => {
    engineRef.current?.setRule({ ...rule, classId });
  }, [rule, classId]);

  useEffect(() => {
    if (!armed || !head || classIndex < 0) return;

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    const engine = new TriggerEngine({ ...rule, classId });
    engineRef.current = engine;
    let cancelled = false;

    timerRef.current = window.setInterval(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        // One reading per running camera, taken in turn through the same
        // canvas. The engine decides what several readings add up to.
        const readings: CameraReading[] = [];
        const maps: Record<string, Float32Array> = {};
        for (const { uid } of camerasRef.current) {
          if (statusRef.current[uid] !== "running") continue;
          const video = videosRef.current.get(uid);
          if (!video || video.readyState < 2) continue;
          try {
            drawFrameForInference(video, canvas);
            const reading = await readFrame(head, canvas, attentionOnRef.current);
            readings.push({ cameraId: uid, score: reading.probabilities[classIndex] });
            if (reading.maps) maps[uid] = reading.maps[classIndex];
          } catch {
            /* one camera dropping a frame shouldn't cost the others theirs */
          }
          if (cancelled) return;
        }
        if (readings.length === 0) return;

        const state = engine.update(readings, Date.now());
        setEngineState({ held: state.heldMs, condition: state.condition, cooling: state.cooling });
        setLive({ scores: state.scores, seeing: state.seeing, maps });
        if (state.fired) {
          const seen = readings.filter((r) => state.seeing.includes(r.cameraId));
          const confidence = Math.max(...(seen.length ? seen : readings).map((r) => r.score));
          void fireRef.current(confidence, state.seeing);
        }
      } finally {
        busyRef.current = false;
      }
    }, PREDICT_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      engineRef.current = null;
      setLive({ scores: {}, seeing: [], maps: {} });
      setEngineState(null);
    };
    // `rule` is applied through setRule above; re-running here would restart the
    // dwell clock on every keystroke in the settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, head, classIndex, classId]);

  const anyRunning = Object.values(statuses).includes("running");
  const activeDeviceIds = cameras.map((c) => c.deviceId).filter((id): id is string => !!id);

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
                hint="Without a cooldown it would fire on every frame for as long as the condition holds."
              />
            </div>

            {/* Only meaningful with two or more cameras. With one, "any" and
                "every" are the same rule, so showing the choice would just be
                a control that does nothing. */}
            {cameras.length < 2 ? (
              <p className="mt-6 text-xs leading-relaxed text-muted">
                Watching with one camera. Add another under &ldquo;Watch with&rdquo; and you can
                choose whether any camera or every camera has to see it.
              </p>
            ) : (
              <div className="mt-6">
                <span className="text-xs font-semibold text-foreground">
                  With {cameras.length} cameras
                </span>
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
                    ? "Use this for “something is there” rules, or when the cameras watch different places. One camera not seeing the dog doesn't mean the dog isn't there."
                    : "Use this for “nothing is there” rules such as “I've left my desk”, where one camera still seeing you means it shouldn't fire. A camera that can only partly see is ignored rather than blocking it."}
                </p>
              </div>
            )}
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
                        // afterwards always came back false, which is why the
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
                      placeholder={disabled ? "Needs an email API key on the server" : action.placeholder}
                      className="mt-1.5 w-full rounded-xl border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                );
              })}
              <p className="text-xs leading-relaxed text-muted">
                These are sent through the server, so your webhook URL isn&apos;t exposed in the
                page. Only https addresses are accepted, and addresses on private networks are
                refused.
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
                    the group it saw, right now that is{" "}
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
                    how sure it was, as a percentage,{" "}
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
                The round brackets are ordinary text. Delete them if you would rather it
                said &ldquo;{activeClassName} 92%&rdquo;.
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
                  Voices come from your device and browser. The ones marked cloud usually sound the
                  most natural.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24">
          <div className={cameras.length > 1 ? "grid grid-cols-2 gap-3" : ""}>
            {cameras.map((camera, index) => (
              <WatchTile
                key={camera.uid}
                uid={camera.uid}
                deviceId={camera.deviceId}
                label={labelFor(camera, index)}
                autoStart={camera.autoStart}
                compact={cameras.length > 1}
                score={live.scores[camera.uid] ?? null}
                seeing={live.seeing.includes(camera.uid)}
                attentionMap={attention.on ? (live.maps[camera.uid] ?? null) : null}
                armed={armed}
                onRemove={cameras.length > 1 ? removeCamera : undefined}
                registerVideo={registerVideo}
                onStatus={onCameraStatus}
              />
            ))}
          </div>

          {anyRunning && hasLabels && devices.length > 1 && (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-semibold text-foreground">Watch with</span>
                <span className="text-[11px] text-muted">
                  {cameras.length} of up to {MAX_WATCH_CAMERAS}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {devices.map((device, index) => {
                  const on = activeDeviceIds.includes(device.deviceId);
                  const disabled =
                    (on && cameras.length === 1) || (!on && cameras.length >= MAX_WATCH_CAMERAS);
                  return (
                    <button
                      key={device.deviceId}
                      onClick={() => toggleDevice(device.deviceId)}
                      disabled={disabled}
                      aria-pressed={on}
                      className="max-w-full truncate rounded-full border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      style={{
                        borderColor: on ? "var(--accent)" : "var(--border-strong)",
                        background: on ? "var(--surface-raised)" : "transparent",
                        color: on ? "var(--accent)" : "var(--foreground)",
                      }}
                    >
                      {shortCameraLabel(device.label, index)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-muted">
                Each camera is checked in turn, so every one you add slows the others a little.
                <span className="lg:hidden"> Phones and tablets often allow only one camera at a time.</span>
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {armed ? "Watching" : "Not watching"}
              </span>
              <button
                onClick={() => setArmed((v) => !v)}
                disabled={!anyRunning}
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
                    ? "Just fired, holding off for the cooldown."
                    : engineState?.condition
                      ? `Holding, ${(engineState.held / 1000).toFixed(1)}s of ${rule.dwellSeconds}s`
                      : "Waiting to see it."}
              </p>
            </div>

            {attention.available && (
              <div className="mt-4 border-t border-border pt-4">
                <AttentionToggle on={attention.on} onToggle={attention.toggle} />
              </div>
            )}

            {log.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
                {log.map((entry, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-mono text-muted">{entry.at}</span>{" "}
                    <span className={entry.error ? "text-foreground" : "text-accent"}>
                      {entry.text}
                    </span>
                    {entry.seenBy && <span className="text-muted"> · {entry.seenBy}</span>}
                    {entry.error && <span className="block text-muted">{entry.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Footer onBack={onBack} onContinue={onContinue} />
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

function Footer({ onBack, onContinue }: { onBack: () => void; onContinue?: () => void }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="rounded-full border border-border-strong px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
        >
          Back
        </button>
        {onContinue && (
          <button
            onClick={onContinue}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02]"
            style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
          >
            Share it
          </button>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        {onContinue
          ? "Watching runs in this tab, so keep it open and in front. Next: a link that runs this detector on any phone or laptop."
          : "Train it first, then set up what happens when it sees something."}
      </p>
    </div>
  );
}
