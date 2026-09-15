/**
 * One theming system, not several. Every theme (including Light and Dark)
 * is the same generator — base hue + saturation "temperature" (bgSat) + mode
 * — fed different parameters. A neutral theme is just a colored theme with
 * bgSat turned way down; Blue is the same formula with bgSat turned up.
 * The concrete values this produces live in globals.css under
 * `[data-theme="..."]`, generated with this exact formula so the numbers
 * stay traceable back here rather than drifting into one-off hex codes.
 *
 * Tokens every theme defines:
 *   --background, --surface, --surface-raised   tonal steps, darkest to lightest (dark mode) or reverse (light)
 *   --foreground, --muted                        text, primary and secondary
 *   --border, --border-strong                     hairlines, tinted by the theme hue
 *   --accent, --accent-strong, --accent-ink       the theme's signature color, its brighter twin, and readable text on it
 *   --glow, --ring                                 soft/strong accent-tinted alpha, used for box-shadow glows and focus rings
 */
export type ThemeMode = "light" | "dark";

export interface ThemeDefinition {
  id: string;
  label: string;
  group: "base" | "color";
  mode: ThemeMode;
  /** Hue (0-360) shared by background tint and accent. */
  hue: number;
  /** How strongly the background/surfaces carry that hue. Low = reads as neutral gray. High = reads as a fully colored theme. */
  bgSat: number;
  /** Swatch color for the theme picker UI. */
  swatch: string;
}

export const THEMES: ThemeDefinition[] = [
  { id: "light", label: "Light", group: "base", mode: "light", hue: 150, bgSat: 8, swatch: "#5cf2a3" },
  { id: "dark", label: "Dark", group: "base", mode: "dark", hue: 150, bgSat: 10, swatch: "#5cf2a3" },
  { id: "blue", label: "Blue", group: "color", mode: "dark", hue: 213, bgSat: 55, swatch: "#3b9dff" },
  { id: "purple", label: "Purple", group: "color", mode: "dark", hue: 265, bgSat: 45, swatch: "#a879ff" },
  { id: "amber", label: "Amber", group: "color", mode: "dark", hue: 28, bgSat: 42, swatch: "#ff9d42" },
  { id: "rose", label: "Rose", group: "color", mode: "dark", hue: 340, bgSat: 42, swatch: "#ff5c94" },
];

export const DEFAULT_THEME = "dark";
export const THEME_STORAGE_KEY = "lookout-theme";

export function isThemeId(value: string | null): value is string {
  return !!value && THEMES.some((t) => t.id === value);
}
