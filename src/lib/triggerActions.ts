"use client";

import type { DispatchAction } from "@/app/api/dispatch/route";

/**
 * Client-only actions fire with no network hop at all, which is why they're
 * instant and work offline. Everything that has to leave the browser goes
 * through /api/dispatch instead — a webhook URL is effectively a secret and
 * has no business sitting in a page.
 */

export type ClientActionId = "speak" | "banner" | "notify";
export type ServerActionId = DispatchAction;

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  // Cancel first: a run of fires otherwise queues up and talks over itself long
  // after the thing has gone.
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
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
 * Fills {what} and {confidence} in a user-written message. Deliberately tiny —
 * this is a message template, not a template language.
 */
export function renderMessage(template: string, className: string, confidence: number): string {
  return template
    .replace(/\{what\}/g, className)
    .replace(/\{confidence\}/g, `${Math.round(confidence * 100)}%`);
}
