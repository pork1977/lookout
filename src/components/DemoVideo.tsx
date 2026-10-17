"use client";

import { useCallback, useEffect, useState } from "react";

export const OPEN_DEMO_VIDEO_EVENT = "lookout:open-demo-video";

/**
 * A recording of the whole loop, for anyone who won't or can't turn a camera on.
 *
 * Until this existed, refusing the camera prompt left a stranger with nothing
 * but "it was blocked, try again" and no idea what the product does. That is
 * most of a locked-down work laptop, a cautious first visit, and anyone who
 * reasonably doesn't want to hand their webcam to a site they just landed on.
 *
 * Mounted once by LiveDemo and opened from anywhere with the event above, the
 * same way the camera is started from the hero.
 */
export default function DemoVideo() {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener(OPEN_DEMO_VIDEO_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DEMO_VIDEO_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    // The page behind a full-screen overlay should not scroll under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Lookout demo video"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-4xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-white/80">
            The whole thing, start to finish, in about forty seconds. No sound needed.
          </p>
          <button
            onClick={close}
            className="shrink-0 rounded-full border border-white/30 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10"
          >
            Close
          </button>
        </div>
        {/*
          Muted and autoplaying because it is a silent screen recording and the
          point is that it starts immediately. preload is irrelevant here since
          nothing renders until someone asks for it, which keeps the 2MB off
          every other visit.
        */}
        <video
          src="/demo.mp4"
          poster="/demo-poster.jpg"
          controls
          autoPlay
          muted
          playsInline
          className="w-full rounded-2xl border border-white/15 shadow-2xl"
        />
      </div>
    </div>
  );
}

/** The way in, wherever someone has just decided against the camera. */
export function WatchDemoButton({ label = "Watch it instead" }: { label?: string }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(OPEN_DEMO_VIDEO_EVENT))}
      className="tile-action shrink-0 whitespace-nowrap rounded-full border border-border-strong font-medium hover:bg-surface-raised"
      style={{ padding: "0.5em 1.3em" }}
    >
      {label}
    </button>
  );
}
