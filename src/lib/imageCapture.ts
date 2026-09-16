"use client";

/**
 * Every example — webcam frame or uploaded file — is normalised to one square
 * JPEG at this size. A uniform set is what lets Phase E feed the model without
 * per-image special cases, and 320px keeps a few hundred photos comfortably in
 * memory while leaving headroom above MobileNet's 224px input.
 */
export const EXAMPLE_SIZE = 320;

const JPEG_QUALITY = 0.85;

/**
 * IMPORTANT, and easy to get silently wrong later: camera frames are stored
 * **mirrored**, matching the selfie-view preview the user is looking at while
 * they capture. Phase E must therefore mirror the live feed at inference too.
 * If it doesn't, every model trains on flipped data and then underperforms on
 * real input with no error to point at.
 */
const MIRROR_CAMERA_FRAMES = true;

/**
 * Draws a source into `canvas` as the one canonical example image: square,
 * centre-cropped, EXAMPLE_SIZE on a side, mirrored if asked.
 *
 * Every path that turns pixels into model input goes through this — capture at
 * build time and the live camera at inference time — so the two cannot drift
 * apart. They must not: a model trained on mirrored frames and run on
 * unmirrored ones just quietly underperforms, with nothing to point at.
 */
export function drawNormalized(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  mirror: boolean,
  canvas: HTMLCanvasElement,
): void {
  canvas.width = EXAMPLE_SIZE;
  canvas.height = EXAMPLE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, EXAMPLE_SIZE, EXAMPLE_SIZE);

  // Centre crop to a square rather than squashing: a stretched subject teaches
  // the model the wrong shape.
  const side = Math.min(sourceWidth, sourceHeight);
  const sx = (sourceWidth - side) / 2;
  const sy = (sourceHeight - side) / 2;

  if (mirror) {
    ctx.translate(EXAMPLE_SIZE, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, side, side, 0, 0, EXAMPLE_SIZE, EXAMPLE_SIZE);
}

/**
 * Prepares a live camera frame for inference, with exactly the transform its
 * training photos were stored with.
 */
export function drawFrameForInference(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  drawNormalized(video, video.videoWidth, video.videoHeight, MIRROR_CAMERA_FRAMES, canvas);
}

function normalize(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  mirror: boolean,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  drawNormalized(source, sourceWidth, sourceHeight, mirror, canvas);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/** Grabs the current frame from a playing video element. */
export function frameToBlob(video: HTMLVideoElement): Promise<Blob> {
  return normalize(video, video.videoWidth, video.videoHeight, MIRROR_CAMERA_FRAMES);
}

/**
 * Uploaded photos are not mirrored — they were taken by a real camera facing
 * the right way, so flipping them would be the inconsistency, not the fix.
 */
export async function fileToBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    return await normalize(bitmap, bitmap.width, bitmap.height, false);
  } finally {
    bitmap.close();
  }
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}
