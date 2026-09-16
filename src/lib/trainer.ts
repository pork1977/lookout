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
