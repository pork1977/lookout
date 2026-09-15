"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES, isThemeId } from "@/lib/theme";

// The active theme lives as a DOM attribute (set synchronously pre-paint by
// the blocking script in layout.tsx, and by applyTheme() below), not in
// React state. useSyncExternalStore keeps this component in sync with that
// external source without ever needing to setState from an effect.
function subscribeToThemeAttr(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getThemeAttrSnapshot() {
  const current = document.documentElement.getAttribute("data-theme");
  return isThemeId(current) ? current : DEFAULT_THEME;
}

function getServerThemeSnapshot() {
  return DEFAULT_THEME;
}

function SwatchDot({ color, active }: { color: string; active?: boolean }) {
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
      style={{
        background: color,
        boxShadow: active ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${color}` : undefined,
      }}
    />
  );
}

export default function ThemeSwitcher() {
  const themeId = useSyncExternalStore(
    subscribeToThemeAttr,
    getThemeAttrSnapshot,
    getServerThemeSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setColorMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setColorMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function applyTheme(id: string) {
    document.documentElement.setAttribute("data-theme", id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // localStorage unavailable (private browsing, etc). Theme still applies for this session.
    }
    setOpen(false);
    setColorMenuOpen(false);
  }

  const baseThemes = THEMES.filter((t) => t.group === "base");
  const colorThemes = THEMES.filter((t) => t.group === "color");
  const active = THEMES.find((t) => t.id === themeId) ?? THEMES[1];
  const activeIsColor = active.group === "color";

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${active.label}`}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border-strong transition-colors hover:bg-surface-raised"
      >
        <SwatchDot color={active.swatch} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-border-strong bg-surface p-1.5 shadow-2xl"
          style={{ boxShadow: "0 20px 50px -20px rgba(0,0,0,0.6)" }}
        >
          {baseThemes.map((t) => (
            <button
              key={t.id}
              role="menuitemradio"
              aria-checked={t.id === themeId}
              onClick={() => applyTheme(t.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
            >
              <SwatchDot color={t.swatch} active={t.id === themeId} />
              {t.label}
            </button>
          ))}

          <button
            role="menuitem"
            aria-expanded={colorMenuOpen}
            onClick={() => setColorMenuOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <span className="flex items-center gap-2.5">
              <span
                className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                style={{
                  background:
                    "conic-gradient(from 180deg, #3b9dff, #a879ff, #ff5c94, #ff9d42, #3b9dff)",
                  boxShadow: activeIsColor
                    ? `0 0 0 2px var(--surface), 0 0 0 3.5px ${active.swatch}`
                    : undefined,
                }}
              />
              Custom Color
            </span>
            <span
              className="text-xs text-muted transition-transform"
              style={{ transform: colorMenuOpen ? "rotate(90deg)" : undefined }}
            >
              ›
            </span>
          </button>

          {colorMenuOpen && (
            <div className="mt-1 grid grid-cols-2 gap-1 border-t border-border px-1.5 pt-1.5">
              {colorThemes.map((t) => (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={t.id === themeId}
                  onClick={() => applyTheme(t.id)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
                >
                  <SwatchDot color={t.swatch} active={t.id === themeId} />
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
