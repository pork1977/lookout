import type { ObjectDetector } from "@mediapipe/tasks-vision";

/**
 * The homepage demo's detector: Google's MediaPipe object detector running
 * EfficientDet-Lite0, which knows the same 80 everyday COCO objects.
 *
 * It replaced TensorFlow.js COCO-SSD outright. COCO-SSD was noticeably worse at
 * small and distant objects, and getting its accurate variant meant downloading
 * about 85MB of weights (an 18MB warm-up model, then a 67MB one). This is a
 * 7MB model plus an 11.7MB runtime that travels compressed at about 3MB.
 *
 * The runtime files are copied out of the installed package into /public at
 * build time (scripts/copy-mediapipe.mjs), so they always match the JS that
 * loads them and the demo doesn't depend on a third-party CDN being up.
 */

export interface DetectedObject {
  /** [x, y, width, height] in the video's own pixels. */
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

/** Upper bound on boxes per frame. */
const MAX_BOXES = 20;

/**
 * Two thresholds, deliberately.
 *
 * The tracking list is persistent: once an object earns a row it keeps it for
 * the session. A single low cutoff would make one frame of noise a permanent
 * entry, and a single high cutoff would drop real objects the moment they turn
 * or dim. So the model is asked for everything above KEEP_SCORE, and callers
 * apply ADMIT_SCORE before letting a *new* class into the list. Once it's in,
 * KEEP_SCORE is enough to keep it marked active.
 */
export const KEEP_SCORE = 0.32;
export const ADMIT_SCORE = 0.6;

const WASM_PATH = "/mediapipe/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

let startPromise: Promise<void> | null = null;
let detector: ObjectDetector | null = null;

/**
 * One shared queue. Every camera tile detects against the same detector, and
 * letting two or three loops interleave calls into it is a real source of
 * stutter. Serializing costs nothing with a single tile.
 */
let tail: Promise<unknown> = Promise.resolve();

/** Loads the detector once, shared by every tile. GPU first, CPU if the GPU refuses. */
export function startDetector(): Promise<void> {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const create = (delegate: "GPU" | "CPU") =>
      ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "IMAGE",
        maxResults: MAX_BOXES,
        scoreThreshold: KEEP_SCORE,
      });
    try {
      detector = await create("GPU");
    } catch {
      // Some GPUs and drivers refuse the delegate. CPU is slower but works.
      detector = await create("CPU");
    }
  })().catch((err) => {
    // Let the next Start try again rather than caching a failure forever.
    startPromise = null;
    throw err;
  });

  return startPromise;
}

export function detect(video: HTMLVideoElement): Promise<DetectedObject[]> {
  const run = tail.then(() => {
    if (!detector) return [] as DetectedObject[];
    const found: DetectedObject[] = [];
    for (const detection of detector.detect(video).detections) {
      const top = detection.categories[0];
      const box = detection.boundingBox;
      if (!top || !box || top.score < KEEP_SCORE) continue;
      found.push({
        bbox: [box.originX, box.originY, box.width, box.height],
        class: top.categoryName,
        score: top.score,
      });
    }
    return found;
  });
  // The queue must survive a rejected call, or every later tile deadlocks
  // behind it, so the tail tracks a swallowed copy, not `run` itself.
  tail = run.catch(() => undefined);
  return run;
}
