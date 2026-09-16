import type { DetectedObject } from "@tensorflow-models/coco-ssd";
import type { ObjectDetection } from "@tensorflow-models/coco-ssd";

/** Upper bound on boxes per frame — matches coco-ssd's own default. */
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
    const model = accurate ?? fast;
    if (!model) return [] as DetectedObject[];
    return model.detect(video, MAX_BOXES, KEEP_SCORE);
  });
  // The queue must survive a rejected call, or every later tile deadlocks
  // behind it — so the tail tracks a swallowed copy, not `run` itself.
  tail = run.catch(() => undefined);
  return run;
}
