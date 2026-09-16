"use client";

const cache = new Map<string, string>();
let probe: CanvasRenderingContext2D | null | undefined;

const DARK_INK = "#06170f";
const LIGHT_INK = "#ffffff";

/**
 * Picks readable text to sit on top of `color`.
 *
 * Tile colors come from CSS custom properties, so they arrive as whatever
 * syntax the active theme happens to use, `hsl(150 70% 62%)`, a hex string,
 * possibly `oklch()` later. Rather than hand-parsing that, this pushes the
 * color through a 1x1 canvas and reads the rasterized pixel back, which uses
 * the browser's own color parser and handles every syntax it supports.
 *
 * Matters because the Light theme's accent is a *dark* green: the previous
 * hardcoded dark ink rendered as near-invisible on it.
 */
export function inkFor(color: string): string {
  if (typeof document === "undefined") return DARK_INK;

  const cached = cache.get(color);
  if (cached) return cached;

  if (probe === undefined) {
    probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return DARK_INK;

  // An unparseable value leaves fillStyle untouched, so seed a known one
  // first, that way a failure falls back to white ink rather than to
  // whichever color happened to be measured last.
  probe.fillStyle = "#000000";
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;

  // Rec. 601 luma is more than enough for a two-way light/dark decision.
  const ink = (r * 299 + g * 587 + b * 114) / 1000 > 140 ? DARK_INK : LIGHT_INK;
  cache.set(color, ink);
  return ink;
}
