import type { TrackedDetection } from "./types";

/**
 * The list is deliberately append-only. A row appears the first time its object
 * is seen and then stays for the rest of the session, fading heavily when the
 * object leaves frame and coming back when it returns. Rows are also never
 * reordered — sinking inactive ones to the bottom would reintroduce exactly the
 * motion this is meant to remove.
 */
export default function DetectionList({
  detections,
  showCamera,
}: {
  detections: TrackedDetection[];
  showCamera: boolean;
}) {
  const activeCount = detections.reduce((n, d) => n + (d.active ? 1 : 0), 0);

  return (
    <div className="flex h-full min-h-56 flex-col rounded-2xl border border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Tracking</span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[11px] font-medium"
          style={{ background: "var(--surface-raised)", color: "var(--accent)" }}
        >
          {activeCount}
          {detections.length > activeCount && (
            <span className="text-muted"> / {detections.length}</span>
          )}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2"
        // Without a stable gutter, the scrollbar appearing as rows accumulate
        // narrows this column, which widens the camera beside it, which changes
        // its aspect-driven height — a visible feedback loop, not a one-off nudge.
        style={{ scrollbarGutter: "stable" }}
      >
        {detections.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted">Nothing in frame yet.</p>
        )}

        {detections.map((d) => (
          <div
            key={d.key}
            className="flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 hover:border-border hover:bg-surface-raised"
            style={{
              opacity: d.active ? 1 : 0.22,
              // Draining the color as well as the opacity is what keeps a
              // no-longer-visible object from competing for attention — a plain
              // grey at this size still reads as "something to look at".
              filter: d.active ? "none" : "grayscale(1)",
              transition: "opacity 160ms ease, filter 160ms ease",
            }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
              style={{ background: d.cameraColor, color: d.cameraInk }}
            >
              {d.index}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium capitalize text-foreground">
                  {d.label}
                  {d.count > 1 && (
                    <span className="ml-1.5 font-mono text-[11px] text-muted">×{d.count}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {Math.round(d.score * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-raised">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(d.score * 100)}%`,
                    background: `linear-gradient(90deg, ${d.cameraColor}, var(--accent-strong))`,
                    transition: "width 160ms ease",
                  }}
                />
              </div>
              {showCamera && (
                <span className="mt-1 inline-block text-[10px] text-muted">{d.cameraLabel}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
