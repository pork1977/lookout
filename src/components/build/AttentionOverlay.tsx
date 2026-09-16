"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { attentionAvailable } from "@/lib/trainer";

const GRID = 7;
/** How much each new frame moves the drawn map. Low enough to stop it shimmering. */
const SMOOTHING = 0.35;
/**
 * A map whose brightest and dimmest regions are this close together isn't
 * saying anything, so it fades out rather than being stretched into a
 * confident-looking pattern made of noise.
 */
const MEANINGFUL_SPREAD = 0.3;

/**
 * Paints a 7x7 attention map over a square camera view as a soft glow in the
 * theme's accent colour. Expects the map in the same orientation as the frame
 * that was read, which for camera frames is already mirrored to match the
 * mirrored video, so it lines up without any flipping here.
 */
export default function AttentionOverlay({ map }: { map: Float32Array | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothedRef = useRef<Float32Array | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    if (!map) {
      smoothedRef.current = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const previous = smoothedRef.current;
    const smoothed = new Float32Array(map.length);
    for (let i = 0; i < map.length; i++) {
      smoothed[i] = previous ? previous[i] + SMOOTHING * (map[i] - previous[i]) : map[i];
    }
    smoothedRef.current = smoothed;

    let min = Infinity;
    let max = -Infinity;
    for (const v of smoothed) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const spread = max - min;
    const presence = Math.min(1, spread / MEANINGFUL_SPREAD);

    if (!gridRef.current) {
      gridRef.current = document.createElement("canvas");
      gridRef.current.width = GRID;
      gridRef.current.height = GRID;
    }
    const grid = gridRef.current;
    const gridCtx = grid.getContext("2d");
    if (!gridCtx) return;

    const image = gridCtx.createImageData(GRID, GRID);
    for (let i = 0; i < smoothed.length; i++) {
      const normalised = spread > 1e-6 ? (smoothed[i] - min) / spread : 0;
      // Squared, so middling regions stay quiet and the hot spot reads clearly.
      const alpha = normalised * normalised * presence;
      image.data[i * 4 + 3] = Math.round(alpha * 255);
    }
    gridCtx.putImageData(image, 0, 0);

    // Upscale the 7x7 alpha mask smoothly, then colour it with the accent via
    // source-in, which saves parsing whatever colour syntax the theme uses.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(grid, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#34d399";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
  }, [map]);

  return (
    <canvas
      ref={canvasRef}
      width={140}
      height={140}
      aria-hidden
      className="attention-overlay pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

const PREFERENCE_KEY = "lookout.showAttention";

/**
 * Whether the overlay can run here, and whether this viewer wants it on. The
 * preference is remembered per browser so it survives moving between Train and
 * Triggers; if storage is unavailable it simply starts off each time.
 */
export function useAttention(enabled: boolean) {
  const [available, setAvailable] = useState(false);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    attentionAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    // localStorage has no server value, so it can only be read after mount.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOn(window.localStorage.getItem(PREFERENCE_KEY) === "1");
    } catch {
      /* storage blocked; stay off */
    }
  }, []);

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PREFERENCE_KEY, next ? "1" : "0");
      } catch {
        /* not remembered, still works */
      }
      return next;
    });
  }, []);

  return { available, on: available && on, toggle };
}

export function AttentionToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <button
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors"
        style={{
          borderColor: on ? "var(--accent)" : "var(--border-strong)",
          background: on ? "var(--accent)" : "var(--surface-raised)",
        }}
      >
        <span
          className="absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left] duration-150"
          style={{ left: on ? 18 : 2, background: on ? "var(--accent-ink)" : "var(--muted)" }}
        />
        <span className="sr-only">Show what it&apos;s looking at</span>
      </button>
      <div className="min-w-0">
        <span className="block text-xs font-medium text-foreground">Show what it&apos;s looking at</span>
        <span className="block text-xs leading-relaxed text-muted">
          Lights up the parts of the picture that made it decide.
        </span>
      </div>
    </div>
  );
}
