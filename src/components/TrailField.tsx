/**
 * Decorative light trails behind the hero.
 *
 * Pure SVG and CSS, no canvas, no animation frames, no JavaScript running.
 * The live demo already asks a lot of the GPU, and a decorative background has
 * no business competing with it for frames. Colour comes from the theme tokens,
 * so it re-tints with every preset rather than being a fixed green.
 */
export default function TrailField() {
  return (
    <svg
      className="trail-field pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
    >
      <defs>
        {/* Each trail is a short bright dash travelling along an invisible
            path. Fading both ends stops it reading as a moving line segment
            and makes it read as light instead. */}
        <linearGradient id="trail-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="45%" stopColor="var(--accent)" stopOpacity="0.9" />
          <stop offset="55%" stopColor="var(--accent-strong)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity="0" />
        </linearGradient>

        <filter id="trail-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g fill="none" stroke="url(#trail-fade)" filter="url(#trail-glow)" strokeLinecap="round">
        <path className="trail trail-1" d="M-100 120 C 220 60, 380 210, 700 150 S 1080 40, 1320 110" strokeWidth="1.5" />
        <path className="trail trail-2" d="M-100 330 C 260 250, 420 430, 760 350 S 1100 250, 1320 320" strokeWidth="1.2" />
        <path className="trail trail-3" d="M-100 540 C 200 470, 460 620, 780 540 S 1120 460, 1320 520" strokeWidth="1.5" />
        <path className="trail trail-4" d="M-100 240 C 300 300, 520 120, 840 240 S 1140 360, 1320 260" strokeWidth="1" />
      </g>

      {/* Faint static guides, so the paths still read as a circuit when the
          trails are stopped for reduced motion. */}
      <g
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.07"
        strokeWidth="1"
        strokeLinecap="round"
      >
        <path d="M-100 120 C 220 60, 380 210, 700 150 S 1080 40, 1320 110" />
        <path d="M-100 330 C 260 250, 420 430, 760 350 S 1100 250, 1320 320" />
        <path d="M-100 540 C 200 470, 460 620, 780 540 S 1120 460, 1320 520" />
        <path d="M-100 240 C 300 300, 520 120, 840 240 S 1140 360, 1320 260" />
      </g>
    </svg>
  );
}
