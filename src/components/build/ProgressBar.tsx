"use client";

/**
 * Shared by the labelling and training steps.
 *
 * `indeterminate` is for phases with nothing honest to count — a model
 * downloading, a request in flight — where a made-up percentage would be worse
 * than admitting the work isn't measurable yet.
 */
export default function ProgressBar({
  value = 0,
  indeterminate = false,
  active = true,
}: {
  /** 0 to 1. */
  value?: number;
  indeterminate?: boolean;
  /** Whether work is still happening — drives the travelling sheen. */
  active?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;

  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      {indeterminate ? (
        <div
          className="animate-progress-sweep absolute inset-y-0 left-0 w-2/5 rounded-full"
          style={{
            background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
          }}
        />
      ) : (
        <div
          className="relative h-full overflow-hidden rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--accent), var(--accent-strong))",
            boxShadow: "0 0 14px -2px var(--glow)",
            // Eased rather than linear, so a step forward reads as movement
            // rather than a jump.
            transition: "width 420ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {active && pct > 0 && (
            <span
              className="animate-progress-sheen absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
