"use client";

import { useEffect, useState } from "react";

/**
 * Resolves a CSS custom property (e.g. "--accent") to its current computed
 * value, and re-resolves whenever the theme changes. Canvas drawing can't
 * read var(--accent) directly, so this is how the live-demo boxes stay in
 * sync with whichever theme is active.
 */
export function useThemeColor(varName: string, fallback: string): string {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    function resolve() {
      const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      if (resolved) setValue(resolved);
    }
    resolve();

    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [varName]);

  return value;
}
