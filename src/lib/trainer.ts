"use client";

import type * as tfTypes from "@tensorflow/tfjs";
import type { MobileNet } from "@tensorflow-models/mobilenet";

/**
 * Transfer learning, the Teachable Machine mechanic: a frozen MobileNet turns
 * each photo into a feature vector once, and only a small head is trained on
 * those vectors. Training is then seconds of arithmetic on a few hundred short
 * vectors rather than backprop through a whole convnet, which is what makes
 * "train it in your browser" honest rather than a queued job in disguise.
 */

export const TRAINING_EPOCHS = 30;
const BATCH_SIZE = 16;
const LEARNING_RATE = 0.001;
const HIDDEN_UNITS = 100;

let tfPromise: Promise<typeof tfTypes> | null = null;
let extractorPromise: Promise<MobileNet> | null = null;

async function getTf(): Promise<typeof tfTypes> {
  if (!tfPromise) {
    tfPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      // Same reason as the live demo: without asking, the runtime can settle on
      // the CPU backend and turn seconds of training into minutes.
      try {
        await tf.setBackend("webgl");
      } catch {
        /* fall through to whatever is registered */
      }
      await tf.ready();
      return tf;
    })().catch((err) => {
      tfPromise = null;
      throw err;
    });
  }
  return tfPromise;
}

/** Loads the frozen feature extractor once and shares it across train and test. */
export async function loadExtractor(): Promise<MobileNet> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      await getTf();
      const mobilenet = await import("@tensorflow-models/mobilenet");
      // v2 for better features than v1 at a similar download; this model is only
      // ever run forward, never trained, so its cost is one download per session.
      return mobilenet.load({ version: 2, alpha: 1.0 });
    })().catch((err) => {
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

/**
 * One photo's feature vector. Kept as plain numbers rather than a live tensor so
 * nothing has to be disposed by callers, and so embeddings survive a retrain.
 */
export type Embedding = Float32Array;

/**
 * Turns a stored example into a feature vector.
 *
 * Stored examples are already square, EXAMPLE_SIZE, and mirrored, they went
 * through drawNormalized on the way in, so there is nothing to transform here.
 */
export async function embedBlob(blob: Blob): Promise<Embedding> {
  const tf = await getTf();
  const extractor = await loadExtractor();
  const bitmap = await createImageBitmap(blob);
  try {
    const activation = tf.tidy(() => extractor.infer(tf.browser.fromPixels(bitmap), true));
    try {
      return (await activation.data()) as Float32Array;
    } finally {
      activation.dispose();
    }
  } finally {
    bitmap.close();
  }
}

/** Turns a canvas already drawn by drawFrameForInference into a feature vector. */
export async function embedCanvas(canvas: HTMLCanvasElement): Promise<Embedding> {
  const tf = await getTf();
  const extractor = await loadExtractor();
  const activation = tf.tidy(() => extractor.infer(tf.browser.fromPixels(canvas), true));
  try {
    return (await activation.data()) as Float32Array;
  } finally {
    activation.dispose();
  }
}

export interface TrainingSample {
  embedding: Embedding;
  classIndex: number;
}

export interface EpochProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy: number;
}

export interface TrainedHead {
  model: tfTypes.LayersModel;
  classIds: string[];
  /** Accuracy on the training set itself, useful as a signal, not a guarantee. */
  finalAccuracy: number;
}

export async function trainHead(
  samples: TrainingSample[],
  classIds: string[],
  onEpoch: (progress: EpochProgress) => void,
): Promise<TrainedHead> {
  const tf = await getTf();
  if (samples.length === 0) throw new Error("There are no photos to train on.");

  const featureCount = samples[0].embedding.length;
  const xsData = new Float32Array(samples.length * featureCount);
  samples.forEach((sample, i) => xsData.set(sample.embedding, i * featureCount));

  const xs = tf.tensor2d(xsData, [samples.length, featureCount]);
  const ys = tf.oneHot(
    tf.tensor1d(
      samples.map((s) => s.classIndex),
      "int32",
    ),
    classIds.length,
  );

  const model = tf.sequential({
    layers: [
      tf.layers.dense({
        inputShape: [featureCount],
        units: HIDDEN_UNITS,
        activation: "relu",
        kernelInitializer: "varianceScaling",
        useBias: true,
      }),
      tf.layers.dense({
        units: classIds.length,
        activation: "softmax",
        kernelInitializer: "varianceScaling",
        useBias: false,
      }),
    ],
  });

  model.compile({
    optimizer: tf.train.adam(LEARNING_RATE),
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });

  let finalAccuracy = 0;
  try {
    await model.fit(xs, ys, {
      epochs: TRAINING_EPOCHS,
      // A batch larger than the dataset silently becomes one batch per epoch,
      // which trains badly on the small sets this flow encourages.
      batchSize: Math.max(1, Math.min(BATCH_SIZE, samples.length)),
      shuffle: true,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          const accuracy = (logs?.acc as number | undefined) ?? 0;
          finalAccuracy = accuracy;
          onEpoch({
            epoch: epoch + 1,
            totalEpochs: TRAINING_EPOCHS,
            loss: (logs?.loss as number | undefined) ?? 0,
            accuracy,
          });
        },
      },
    });
  } finally {
    xs.dispose();
    ys.dispose();
  }

  return { model, classIds, finalAccuracy };
}

/** Runs one feature vector through the trained head. Returns a probability per class. */
export async function predict(head: TrainedHead, embedding: Embedding): Promise<number[]> {
  const tf = await getTf();
  const output = tf.tidy(() => {
    const input = tf.tensor2d(embedding, [1, embedding.length]);
    return head.model.predict(input) as tfTypes.Tensor;
  });
  try {
    const probabilities = await output.data();
    return Array.from(probabilities);
  } finally {
    output.dispose();
  }
}

export function disposeHead(head: TrainedHead | null) {
  head?.model.dispose();
}

/**
 * "What it's looking at": a class activation map, computed for free.
 *
 * MobileNet's embedding is the average of a 7x7 grid of 1280-number feature
 * vectors, one per region of the frame (checked: the mean of that grid matches
 * the model's own pooled output to within 5e-7). So instead of asking the
 * model for the pooled vector, ask for the grid, average it ourselves for the
 * normal prediction, and also run the head on each of the 49 regions on its
 * own. A region the head scores highly for a group is a region that looks like
 * that group. The head is tiny, so all 50 rows go through it in one call and
 * the whole thing costs about the same as a plain prediction.
 *
 * The one fragile part is reaching the grid at all: it means running the
 * pinned @tensorflow-models/mobilenet 2.1.1 graph by an internal node name. It
 * is looked up rather than hardcoded, and if the lookup or the run ever fails,
 * `attentionAvailable` goes false, the toggle hides, and predictions carry on
 * through the ordinary path. Detection never depends on this.
 */
const POOL_NODE = "module_apply_default/MobilenetV2/Logits/AvgPool";
const GRID = 7;

interface SpatialGraph {
  execute: (input: tfTypes.Tensor, outputs: string) => tfTypes.Tensor;
  feeder: string;
  scale: number;
  offset: number;
}

let spatialGraph: SpatialGraph | null | undefined;

function resolveSpatialGraph(extractor: MobileNet): SpatialGraph | null {
  if (spatialGraph !== undefined) return spatialGraph;
  try {
    const impl = extractor as unknown as {
      model?: {
        execute?: (input: tfTypes.Tensor, outputs: string) => tfTypes.Tensor;
        executor?: { graph?: { nodes?: Record<string, { inputs?: Array<{ name?: string }> }> } };
      };
      normalizationConstant?: number;
      inputMin?: number;
    };
    const model = impl.model;
    const feeder = model?.executor?.graph?.nodes?.[POOL_NODE]?.inputs?.[0]?.name;
    spatialGraph =
      model?.execute && feeder
        ? {
            execute: model.execute.bind(model),
            feeder,
            // Version 2 expects pixels in [-1, 1]; read the package's own
            // values when they are there so the two paths can't drift apart.
            scale: impl.normalizationConstant ?? 2 / 255,
            offset: impl.inputMin ?? -1,
          }
        : null;
  } catch {
    spatialGraph = null;
  }
  return spatialGraph;
}

/** Whether the attention overlay can run in this browser with this model. */
export async function attentionAvailable(): Promise<boolean> {
  try {
    return resolveSpatialGraph(await loadExtractor()) !== null;
  } catch {
    return false;
  }
}

export interface FrameReading {
  /** Probability per class, identical to predict(head, embedCanvas(canvas)). */
  probabilities: number[];
  /**
   * Per class, a 7x7 grid (row by row, in the canvas's own orientation) of how
   * strongly each region reads as that class. Null when not asked for or not
   * available.
   */
  maps: Float32Array[] | null;
}

/**
 * Reads one frame drawn by drawFrameForInference. With `withAttention`, also
 * returns the per-region maps described above, at no extra MobileNet cost.
 */
export async function readFrame(
  head: TrainedHead,
  canvas: HTMLCanvasElement,
  withAttention: boolean,
): Promise<FrameReading> {
  const extractor = await loadExtractor();
  const graph = withAttention ? resolveSpatialGraph(extractor) : null;
  if (!graph) {
    return { probabilities: await predict(head, await embedCanvas(canvas)), maps: null };
  }

  const tf = await getTf();
  let output: tfTypes.Tensor;
  try {
    output = tf.tidy(() => {
      const pixels = tf.browser.fromPixels(canvas);
      let normalized = tf.add(tf.mul(tf.cast(pixels, "float32"), graph.scale), graph.offset);
      if (pixels.shape[0] !== 224 || pixels.shape[1] !== 224) {
        normalized = tf.image.resizeBilinear(normalized as tfTypes.Tensor3D, [224, 224], true);
      }
      const batched = tf.reshape(normalized, [1, 224, 224, 3]);
      const spatial = graph.execute(batched, graph.feeder);
      const depth = spatial.shape[3] as number;
      const pooled = tf.reshape(tf.mean(spatial, [1, 2]), [1, depth]);
      const regions = tf.reshape(spatial, [GRID * GRID, depth]);
      return head.model.predict(tf.concat([pooled, regions], 0)) as tfTypes.Tensor;
    });
  } catch {
    // Something about the graph didn't hold. Stop trying for the rest of the
    // session and answer this frame the ordinary way.
    spatialGraph = null;
    return { probabilities: await predict(head, await embedCanvas(canvas)), maps: null };
  }

  try {
    const data = (await output.data()) as Float32Array;
    const classCount = head.classIds.length;
    const probabilities = Array.from(data.subarray(0, classCount));
    const maps = Array.from({ length: classCount }, (_, k) => {
      const map = new Float32Array(GRID * GRID);
      for (let cell = 0; cell < map.length; cell++) map[cell] = data[(cell + 1) * classCount + k];
      return map;
    });
    return { probabilities, maps };
  } finally {
    output.dispose();
  }
}
