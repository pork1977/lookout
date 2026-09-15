import type { ObjectDetection } from "@tensorflow-models/coco-ssd";

/**
 * The COCO-SSD model is stateless and safe to share across every camera
 * tile — loading it once and reusing it means a second or third camera in
 * grid mode is instant instead of re-downloading and re-initializing the
 * same weights.
 */
let modelPromise: Promise<ObjectDetection> | null = null;

export function loadDetectorModel(): Promise<ObjectDetection> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const [tf, cocoSsd] = await Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/coco-ssd"),
      ]);
      await tf.ready();
      return cocoSsd.load({ base: "lite_mobilenet_v2" });
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}
