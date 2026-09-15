export interface TrackedDetection {
  /** Position in this frame's detection list; drawn on canvas as a numbered badge and matched to the side list by the same number. */
  index: number;
  label: string;
  score: number;
  /** Which camera tile this came from, for the shared tracking list in grid mode. */
  cameraLabel: string;
  cameraColor: string;
}
