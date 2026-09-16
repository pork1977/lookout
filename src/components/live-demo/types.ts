export interface TrackedDetection {
  /** Stable React key: unique per camera tile and object class, for the whole session. */
  key: string;
  /**
   * Badge number drawn on this object's bounding boxes. Assigned the first
   * time the class is seen on that camera and kept for the rest of the
   * session, so a list row and its boxes always agree — unlike a per-frame
   * position, which renumbered everything whenever anything moved.
   */
  index: number;
  label: string;
  /** Confidence from the most recent frame this object was actually visible in. */
  score: number;
  /** How many boxes of this class were in that frame. */
  count: number;
  /** False once the object leaves frame. The row stays, heavily faded — it is never removed. */
  active: boolean;
}

/**
 * One camera's worth of tracking, for the grouped list.
 *
 * Camera identity lives here rather than repeated on every detection: the tile
 * emits a few times a second behind a change-signature throttle that doesn't
 * include color, so a theme switch couldn't propagate through it. Sourcing the
 * color from the parent instead means theme changes land immediately.
 */
export interface DetectionGroup {
  uid: string;
  cameraLabel: string;
  cameraColor: string;
  detections: TrackedDetection[];
}
