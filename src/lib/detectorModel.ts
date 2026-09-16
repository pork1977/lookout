import type { DetectedObject } from "@tensorflow-models/coco-ssd";
import type { ObjectDetection } from "@tensorflow-models/coco-ssd";
import type { ObjectDetector } from "@mediapipe/tasks-vision";

/** Upper bound on boxes per frame, matches coco-ssd's own default. */
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

let startPromise: Promise<void> | null = null;
let fast: ObjectDetection | null = null;
let accurate: ObjectDetection | null = null;

/**
 * One shared queue. Every camera tile detects against the same model instance,
 * and letting two or three requestAnimationFrame loops interleave calls into it
 * is a real source of stutter. Serializing costs nothing with a single tile and
 * keeps a three-camera grid smooth.
 */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Loads the detector once, shared by every tile.
 *
 * Starts on the small base so the demo goes live quickly, then quietly
 * upgrades to the most accurate base coco-ssd offers once it has downloaded.
 * Detection just gets better a few seconds in; nothing restarts, and the
 * first-load stall the small base was chosen to avoid still doesn't happen.
 */
export function startDetector(): Promise<void> {
  if (startPromise) return startPromise;

  startPromise = (async () => {
    const [tf, cocoSsd] = await Promise.all([
      import("@tensorflow/tfjs"),
      import("@tensorflow-models/coco-ssd"),
    ]);

    // Without asking explicitly, the runtime can settle on the CPU backend,
    // which turns a ~40ms detect into a multi-second one. If WebGL genuinely
    // isn't available the call throws and tf.ready() picks whatever is.
    try {
      await tf.setBackend("webgl");
    } catch {
      /* fall through to the default backend */
    }
    await tf.ready();

    fast = await cocoSsd.load({ base: "lite_mobilenet_v2" });

    void cocoSsd
      .load({ base: "mobilenet_v2" })
      .then((model) => {
        const previous = fast;
        accurate = model;
        // Free the warm-up model's tensors, but only behind the queue: calls
        // enqueued before this line are still holding it, calls enqueued after
        // already read `accurate`. Skipping this left both models resident in
        // GPU memory for the whole session.
        tail = tail.then(() => previous?.dispose()).catch(() => undefined);
      })
      .catch(() => {
        /* stay on the fast base; detection still works */
      });
  })().catch((err) => {
    startPromise = null;
    throw err;
  });

  return startPromise;
}

/** Which base is answering right now. The tile shows a "refining" chip until this flips. */
export function detectorQuality(): "fast" | "accurate" {
  return accurate ? "accurate" : "fast";
}

export function detect(video: HTMLVideoElement): Promise<DetectedObject[]> {
  const run = tail.then(() => {
    if (engine === "sharp" && sharp) {
      try {
        return detectSharp(sharp, video);
      } catch {
        // A GPU delegate that loaded but can't actually run on this device.
        // Say so once, then carry on with the standard detector this frame.
        failSharp();
      }
    }
    const model = accurate ?? fast;
    if (!model) return [] as DetectedObject[];
    return model.detect(video, MAX_BOXES, KEEP_SCORE);
  });
  // The queue must survive a rejected call, or every later tile deadlocks
  // behind it, so the tail tracks a swallowed copy, not `run` itself.
  tail = run.catch(() => undefined);
  return run;
}

/**
 * "Sharper detection": Google's MediaPipe object detector (EfficientDet-Lite0)
 * as an opt-in alternative to coco-ssd. Same 80 everyday COCO objects, but it
 * holds on to small and distant things noticeably better.
 *
 * It is strictly optional and strictly additive. Nothing downloads until it is
 * switched on (about 7MB of model plus the runtime), GPU is tried before CPU,
 * and if either the load or a later detect fails, it reports "failed" and every
 * tile carries straight on with coco-ssd, which stays loaded underneath the
 * whole time. Versions are pinned so a new release can't change behaviour
 * underneath a working deployment.
 */
export type DetectorEngine = "standard" | "sharp";
export type SharpStatus = "off" | "loading" | "ready" | "failed";

const MEDIAPIPE_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MEDIAPIPE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

let engine: DetectorEngine = "standard";
let sharp: ObjectDetector | null = null;
let sharpStatus: SharpStatus = "off";
let sharpPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeDetectorEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A string, so React's useSyncExternalStore can compare snapshots cheaply. */
export function detectorEngineSnapshot(): `${DetectorEngine}:${SharpStatus}` {
  return `${engine}:${sharpStatus}`;
}

function failSharp() {
  engine = "standard";
  sharpStatus = "failed";
  emit();
}

export function setDetectorEngine(next: DetectorEngine) {
  if (next === "standard") {
    engine = "standard";
    if (sharpStatus !== "failed") sharpStatus = sharp ? "ready" : "off";
    emit();
    return;
  }

  engine = "sharp";
  if (sharp) {
    sharpStatus = "ready";
    emit();
    return;
  }
  sharpStatus = "loading";
  emit();
  if (sharpPromise) return;

  sharpPromise = (async () => {
    const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    const create = (delegate: "GPU" | "CPU") =>
      ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MEDIAPIPE_MODEL, delegate },
        runningMode: "IMAGE",
        maxResults: MAX_BOXES,
        scoreThreshold: KEEP_SCORE,
      });
    let detector: ObjectDetector;
    try {
      detector = await create("GPU");
    } catch {
      // Some GPUs and drivers refuse the delegate; CPU is slower but works.
      detector = await create("CPU");
    }
    sharp = detector;
    sharpStatus = "ready";
    emit();
  })().catch(() => {
    sharpPromise = null;
    failSharp();
  });
}

function detectSharp(detector: ObjectDetector, video: HTMLVideoElement): DetectedObject[] {
  const result = detector.detect(video);
  const found: DetectedObject[] = [];
  for (const detection of result.detections) {
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
}
