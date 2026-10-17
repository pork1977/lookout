"use client";

/**
 * Writing down what a detector caught.
 *
 * Kept apart from the trigger actions on purpose: speaking, banners and
 * webhooks are things that happen to the person watching, and this is the
 * record that survives them closing the tab. A detector that fires while
 * nobody is looking is the normal case, not the exception.
 *
 * Everything here swallows its own failures. A full disk or a private window
 * should cost you the history entry, never the alert itself.
 */
import { addHistory } from "./detectorStore";
import { frameToThumbnail } from "./imageCapture";

export interface TriggerEvent {
  detectorId: string;
  className: string;
  confidence: number;
  message: string;
  cameras?: string;
  /** The camera that saw it, when one is still on screen to grab from. */
  video?: HTMLVideoElement | null;
}

export async function recordTrigger(event: TriggerEvent): Promise<void> {
  try {
    let thumb: Blob | undefined;
    const video = event.video;
    // videoWidth is 0 until the stream actually has a frame, and drawing that
    // produces a blank square rather than an error.
    if (video && video.videoWidth > 0) {
      try {
        thumb = await frameToThumbnail(video);
      } catch {
        /* no picture is fine, the entry is still worth keeping */
      }
    }

    await addHistory({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      detectorId: event.detectorId,
      at: Date.now(),
      className: event.className,
      confidence: event.confidence,
      message: event.message,
      cameras: event.cameras,
      thumb,
    });
  } catch {
    /* losing a history entry must never interrupt the thing that fired */
  }
}
