"use client";

import { START_DEMO_EVENT } from "./live-demo/CameraTile";

/**
 * On a wide screen the demo sits beside the hero, so a plain #demo link had
 * nowhere to scroll to and looked like it did nothing. This brings the demo
 * into view (which matters on phones, where it's below) and starts the camera.
 */
export default function TryDemoButton() {
  return (
    <button
      onClick={() => {
        document.getElementById("demo-frame")?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.dispatchEvent(new Event(START_DEMO_EVENT));
      }}
      className="rounded-full px-6 py-3 text-sm font-semibold text-accent-ink shadow-[0_10px_30px_-8px_var(--glow)] transition-transform hover:scale-[1.02]"
      style={{ backgroundImage: "linear-gradient(135deg, var(--accent), var(--accent-strong))" }}
    >
      Try the live demo
    </button>
  );
}
