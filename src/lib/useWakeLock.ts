"use client";

import { useEffect, useRef } from "react";

/**
 * Holds a screen wake lock while `active`.
 *
 * This matters more on a phone than it sounds. When an iPhone locks its
 * screen the page is suspended: the camera stops, the prediction loop stops
 * with it, and a detector set up to notice someone coming back notices
 * nothing at all. Put the phone down to go and make a cup of tea and the one
 * event it exists to catch is the one it is asleep for.
 *
 * The browser releases the lock itself whenever the page is hidden, so it is
 * taken again on the way back. Support is patchy and a request can be refused
 * outright, on low battery for instance, so nothing here depends on it
 * working: it makes watching survive longer, it doesn't make it correct.
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.wakeLock) return;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || sentinelRef.current || document.visibilityState !== "visible") return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        /* refused is a normal answer here, not an error worth showing */
      }
    };

    void acquire();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinelRef.current?.release().catch(() => {});
      sentinelRef.current = null;
    };
  }, [active]);
}
