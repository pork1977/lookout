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
  /** Which camera tile this came from, for the shared tracking list in grid mode. */
  cameraLabel: string;
  cameraColor: string;
  /** Readable text color on top of cameraColor, resolved once in the browser. */
  cameraInk: string;
}
