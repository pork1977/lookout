"use client";

/**
 * Resolution rungs tried in order when a camera won't open.
 *
 * Several USB webcams on one controller can exceed the bus's bandwidth, and the
 * third one to start then fails outright, a resource problem, not a permission
 * problem, and dropping the resolution is the standard way out of it.
 * `deviceId: { exact }` is re-applied on every rung on purpose: relaxing it
 * would let the browser quietly hand back a *different* camera, and the caller
 * would show the wrong feed under the right name.
 */
const CONSTRAINT_LADDER: MediaTrackConstraints[] = [
  { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 20 } },
  { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } },
  {},
];

/** Failures worth retrying at a lower resolution. A denied permission is not one. */
const RESOURCE_ERRORS = new Set(["NotReadableError", "AbortError", "OverconstrainedError"]);

/**
 * "Blocked or unavailable" covers both cases and explains neither. A camera the
 * bus can't fit is a different problem from one the user declined, and only one
 * of them is fixed by changing a permission.
 */
export function classifyCameraError(err: unknown): "denied" | "busy" {
  const name = (err as DOMException)?.name;
  return RESOURCE_ERRORS.has(name) ? "busy" : "denied";
}

/**
 * Opens a camera, falling back down the resolution ladder if the device is
 * there but can't be driven at the size asked for.
 */
export async function openCameraStream(
  targetDeviceId: string | undefined,
  preferred: MediaTrackConstraints,
): Promise<MediaStream> {
  const rungs = [
    preferred,
    ...CONSTRAINT_LADDER.map((rung) =>
      targetDeviceId ? { ...rung, deviceId: { exact: targetDeviceId } } : rung,
    ),
  ];

  let lastError: unknown;
  for (const video of rungs) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      lastError = err;
      // Retrying a refused permission at a lower resolution is pointless and
      // makes the UI feel broken, so only resource failures walk the ladder.
      if (classifyCameraError(err) !== "busy") throw err;
    }
  }
  throw lastError;
}
