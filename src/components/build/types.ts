export interface ExampleImage {
  id: string;
  /**
   * Object URL for the thumbnail. Revoked in exactly three places — deleting
   * one example, deleting a class, and unmounting the wizard. Notably *not*
   * when an example moves between classes: it's the same object moving, and
   * revoking there would blank the thumbnail it just landed on.
   */
  url: string;
  blob: Blob;
  source: "camera" | "upload";
}

export interface DetectorClass {
  id: string;
  name: string;
  examples: ExampleImage[];
}

/** Below this a class can't meaningfully train; the Continue gate enforces it. */
export const MIN_PER_CLASS = 5;

/** What we actually steer people towards — shown as guidance, not enforced. */
export const RECOMMENDED_PER_CLASS = 20;

export const MIN_CLASSES = 2;
export const MAX_CLASSES = 5;
