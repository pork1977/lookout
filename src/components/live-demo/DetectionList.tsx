"use client";

import { inkFor } from "@/lib/colorInk";
import type { DetectionGroup, TrackedDetection } from "./types";

/**
 * The list is deliberately append-only. A row appears the first time its object
 * is seen and then stays for the rest of the session, fading heavily when the
 * object leaves frame and coming back when it returns. Rows are also never
 * reordered, sinking inactive ones to the bottom would reintroduce exactly the
 * motion this is meant to remove.
 */
export default function DetectionList({
  groups,
  grouped,
}: {
  groups: DetectionGroup[];
  /** With one camera the headings are just noise, so rows render flat. */
  grouped: boolean;
}) {
  const all = groups.flatMap((g) => g.detections);
  const activeCount = all.reduce((n, d) => n + (d.active ? 1 : 0), 0);

  return (
    <div className="flex h-full min-h-56 flex-col rounded-2xl border border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Tracking</span>
        <Count active={activeCount} total={all.length} />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto p-2"
        // Without a stable gutter, the scrollbar appearing as rows accumulate
        // narrows this column, which widens the camera beside it, which changes
        // its aspect-driven height, a visible feedback loop, not a one-off nudge.
        style={{ scrollbarGutter: "stable" }}
      >
        {all.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted">Nothing in frame yet.</p>
        )}

        {groups.map((group) =>
          grouped ? (
            <section key={group.uid} className="mb-1 last:mb-0">
              <header
                className="sticky top-0 z-10 -mx-2 flex items-center gap-2 bg-surface/95 px-4 py-2 backdrop-blur-sm"
                // A left rule in the camera's own color ties the group to its
                // tiles and its box outlines without another colored chip.
                style={{ boxShadow: `inset 3px 0 0 ${group.cameraColor}` }}
              >
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {group.cameraLabel}
                </span>
                <Count
                  active={group.detections.reduce((n, d) => n + (d.active ? 1 : 0), 0)}
                  total={group.detections.length}
                />
              </header>

              <div className="space-y-1.5 pt-1.5">
                {group.detections.length === 0 ? (
                  <p className="px-2.5 py-2 text-[11px] text-muted">Nothing in frame yet.</p>
                ) : (
                  group.detections.map((d) => <Row key={d.key} d={d} color={group.cameraColor} />)
                )}
              </div>
            </section>
          ) : (
            <div key={group.uid} className="space-y-1.5">
              {group.detections.map((d) => (
                <Row key={d.key} d={d} color={group.cameraColor} />
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function Count({ active, total }: { active: number; total: number }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium"
      style={{ background: "var(--surface-raised)", color: "var(--accent)" }}
    >
      {active}
      {total > active && <span className="text-muted"> / {total}</span>}
    </span>
  );
}

function Row({ d, color }: { d: TrackedDetection; color: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 hover:border-border hover:bg-surface-raised"
      style={{
        opacity: d.active ? 1 : 0.22,
        // Draining the color as well as the opacity is what keeps a
        // no-longer-visible object from competing for attention, a plain grey
        // at this size still reads as "something to look at".
        filter: d.active ? "none" : "grayscale(1)",
        transition: "opacity 160ms ease, filter 160ms ease",
      }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
        style={{ background: color, color: inkFor(color) }}
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
              background: `linear-gradient(90deg, ${color}, var(--accent-strong))`,
              transition: "width 160ms ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}
