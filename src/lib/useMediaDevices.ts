"use client";

import { useCallback, useEffect, useState } from "react";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

/**
 * Lists available cameras. Device *labels* are only populated by the
 * browser once camera permission has been granted at least once on this
 * origin, so `hasLabels` tells callers whether it's worth showing a picker
 * yet or whether they should prompt for the first camera first.
 */
export function useMediaDevices() {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [hasLabels, setHasLabels] = useState(false);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = all.filter((d) => d.kind === "videoinput");
    setCameras(videoInputs.map((d) => ({ deviceId: d.deviceId, label: d.label })));
    setHasLabels(videoInputs.length > 0 && videoInputs.every((d) => d.label !== ""));
  }, []);

  useEffect(() => {
    // Enumerating devices is an inherently async browser API with no
    // synchronous snapshot to subscribe to (unlike the theme attribute),
    // so this effect's job really is "fetch on mount, then resubscribe"
    // the one legitimate case react-hooks/set-state-in-effect can't model.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    if (!navigator.mediaDevices) return;
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [refresh]);

  return { cameras, hasLabels, refresh };
}
