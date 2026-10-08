"use client";

import type { DispatchAction } from "@/app/api/dispatch/route";

/**
 * Client-only actions fire with no network hop at all, which is why they're
 * instant and work offline. Everything that has to leave the browser goes
 * through /api/dispatch instead, a webhook URL is effectively a secret and
 * has no business sitting in a page.
 */

export type ClientActionId = "speak" | "banner" | "notify";
export type ServerActionId = DispatchAction;

export interface SpeechOptions {
  voiceURI?: string;
  rate?: number;
  pitch?: number;
}

export const DEFAULT_SPEECH: Required<Omit<SpeechOptions, "voiceURI">> = { rate: 1, pitch: 1 };

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * The voice list arrives asynchronously in most browsers, calling getVoices()
 * too early returns an empty array, so callers subscribe rather than ask once.
 */
export function subscribeToVoices(onChange: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!speechSupported()) return () => {};
  const emit = () => onChange(window.speechSynthesis.getVoices());
  emit();
  window.speechSynthesis.addEventListener("voiceschanged", emit);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", emit);
}

/**
 * Picks the best-sounding voice available without any third-party service.
 *
 * The default voice a browser hands you is usually the oldest bundled one
 * that's the flat, robotic sound. Modern browsers ship much better ones
 * alongside it; they're just never chosen for you. Preference order is the
 * newer neural/natural voices, then cloud voices (which are near-always better
 * than the bundled ones), then anything matching the page language.
 */
export function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  if (!voices.length) return undefined;
  const language = typeof navigator !== "undefined" ? navigator.language : "en-US";
  const sameLanguage = voices.filter((v) => v.lang.startsWith(language.slice(0, 2)));
  const pool = sameLanguage.length ? sameLanguage : voices;

  const preferred = /natural|neural|google|siri|premium|enhanced|aria|jenny|libby/i;
  return (
    pool.find((v) => preferred.test(v.name)) ??
    pool.find((v) => !v.localService) ??
    pool.find((v) => v.default) ??
    pool[0]
  );
}

/**
 * iOS only speaks if the page's first utterance came from a user gesture, and
 * a detector's first real one never does: it arrives from the prediction loop
 * several minutes later, by which point iOS silently drops it and every one
 * after it. Speaking a silent utterance from the click that starts watching
 * unlocks the engine for the rest of the session.
 */
export function primeSpeech() {
  if (!speechSupported()) return;
  try {
    // iOS can also leave the engine paused after a backgrounded tab.
    window.speechSynthesis.resume();
    const utterance = new SpeechSynthesisUtterance(" ");
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* an engine that refuses to be primed may still work when it matters */
  }
}

export function speak(text: string, options: SpeechOptions = {}) {
  if (!speechSupported()) return;
  // Cancel first: a run of triggers otherwise queues up and talks over itself
  // long after the thing has gone. Only when something is actually queued,
  // because cancel() immediately followed by speak() is itself a way to lose
  // the utterance on iOS.
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }
  // A tab that was backgrounded can come back paused, and speak() on a paused
  // engine queues silently rather than talking.
  window.speechSynthesis.resume();

  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const voice = options.voiceURI
    ? voices.find((v) => v.voiceURI === options.voiceURI)
    : pickDefaultVoice(voices);
  if (voice) {
    utterance.voice = voice;
    // Without this some engines ignore the voice and fall back to the default.
    utterance.lang = voice.lang;
  }
  utterance.rate = options.rate ?? DEFAULT_SPEECH.rate;
  utterance.pitch = options.pitch ?? DEFAULT_SPEECH.pitch;
  window.speechSynthesis.speak(utterance);
}

export function canNotify(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return canNotify() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!canNotify()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

export function notify(title: string, body: string) {
  if (!canNotify() || Notification.permission !== "granted") return;
  new Notification(title, { body });
}

export interface DispatchRequest {
  action: ServerActionId;
  target: string;
  message: string;
  detectorName?: string;
  className?: string;
  confidence?: number;
}

export async function dispatch(request: DispatchRequest): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: payload?.error ?? "Dispatch failed." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

/**
 * Fills {what} and {confidence} in a user-written message. Deliberately tiny
 * this is a message template, not a template language.
 */
export function renderMessage(template: string, className: string, confidence: number): string {
  return template
    .replace(/\{what\}/g, className)
    .replace(/\{confidence\}/g, `${Math.round(confidence * 100)}%`);
}
