/**
 * Shared contract between the labelling UI and the /api/label route.
 * No server-only imports here — the client imports this too.
 */

/** Images per request. Keeps one call well inside token and body limits. */
export const MAX_IMAGES_PER_REQUEST = 12;

/** Ceiling for one pass over a draft, enforced client-side before batching. */
export const MAX_IMAGES_PER_RUN = 120;

/**
 * Above this, and only when Claude agrees with where the photo already is, a
 * photo is treated as confirmed and never shown for review.
 *
 * Self-reported confidence is not well calibrated, so this is a starting point
 * to tune against real photos rather than a derived number.
 */
export const AGREEMENT_CONFIDENCE = 0.75;

/**
 * Haiku 4.5: this is "does this photo show X", not a reasoning task, and it is
 * the cheapest vision-capable model. Note there is no date suffix on the id.
 */
export const LABELING_MODEL = "claude-haiku-4-5";

export interface LabelRequestImage {
  id: string;
  classId: string;
  /** Raw base64, no data: prefix. */
  data: string;
  mediaType: string;
}

export interface LabelRequestBody {
  description: string;
  classes: Array<{ id: string; name: string }>;
  images: LabelRequestImage[];
}

export interface LabelResult {
  id: string;
  /** null when Claude couldn't place the photo in any group. */
  suggestedClassId: string | null;
  confidence: number;
  note: string;
}

export interface LabelResponseBody {
  results: LabelResult[];
}

export interface LabelAvailability {
  available: boolean;
  model: string;
  maxImagesPerRequest: number;
  maxImagesPerRun: number;
}

/** Splits a list into request-sized batches. */
export function batchImages<T>(items: T[], size = MAX_IMAGES_PER_REQUEST): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

export interface RawLabel {
  image: number;
  group: string;
  confidence: number;
  note: string;
}

export const UNCLEAR_LABEL = "unclear";

/**
 * Lines model verdicts up with the images that were sent.
 *
 * This is the one place where a bug corrupts training data invisibly: a short,
 * repeated or out-of-range index list silently shifts every verdict onto the
 * wrong photo, and nothing downstream can tell. So the whole batch is rejected
 * rather than partially applied, and the caller leaves those photos unchecked.
 *
 * Kept out of the route handler so it can be exercised directly against the
 * malformed shapes a model can actually produce.
 */
export function correlateLabels(
  labels: RawLabel[],
  images: Array<{ id: string }>,
  slugToClassId: Map<string, string>,
): LabelResult[] {
  const seen = new Set<number>();
  for (const label of labels) {
    if (!Number.isInteger(label.image) || label.image < 1 || label.image > images.length) {
      throw new Error("The labelling response referenced an image that wasn't sent.");
    }
    if (seen.has(label.image)) throw new Error("The labelling response repeated an image.");
    seen.add(label.image);
  }
  if (seen.size !== images.length) {
    throw new Error("The labelling response didn't cover every image.");
  }

  return labels
    .slice()
    .sort((a, b) => a.image - b.image)
    .map((label) => ({
      id: images[label.image - 1].id,
      suggestedClassId:
        label.group === UNCLEAR_LABEL ? null : (slugToClassId.get(label.group) ?? null),
      confidence: Math.max(0, Math.min(1, label.confidence)),
      note: label.note.slice(0, 120),
    }));
}
