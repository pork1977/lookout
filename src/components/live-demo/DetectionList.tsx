import type { TrackedDetection } from "./types";

export default function DetectionList({
  detections,
  showCamera,
}: {
  detections: TrackedDetection[];
  showCamera: boolean;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Tracking
        </span>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[11px] font-medium"
          style={{ background: "var(--surface-raised)", color: "var(--accent)" }}
        >
          {detections.length}
        </span>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {detections.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted">
            Nothing in frame yet.
          </p>
        )}

        {detections.map((d, i) => (
          <div
            key={`${d.cameraLabel}-${d.index}-${i}`}
            className="flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-surface-raised"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
              style={{ background: d.cameraColor, color: "#06170f" }}
            >
              {d.index}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium capitalize text-foreground">
                  {d.label}
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
