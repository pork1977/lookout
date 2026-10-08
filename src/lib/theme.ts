/**
 * One theming system, not several. Every theme (including Light and Dark)
 * is the same generator, base hue + saturation "temperature" (bgSat) + mode
 *, fed different parameters. A neutral theme is just a colored theme with
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

/**
 * Backgrounds carry less of the hue than they used to and sit darker, while
 * the accents went up to nearly full chroma. That pairing is the whole trick:
 * a saturated accent on a saturated background of the same hue reads muddy,
 * because the two are competing, and the accent only looks vivid once the
 * surface behind it gets out of its way.
 */
export const THEMES: ThemeDefinition[] = [
  { id: "light", label: "Light", group: "base", mode: "light", hue: 150, bgSat: 18, swatch: "#1be07f" },
  { id: "dark", label: "Dark", group: "base", mode: "dark", hue: 150, bgSat: 12, swatch: "#31f69a" },
  { id: "blue", label: "Blue", group: "color", mode: "dark", hue: 213, bgSat: 40, swatch: "#338bff" },
  { id: "purple", label: "Purple", group: "color", mode: "dark", hue: 265, bgSat: 38, swatch: "#a25cff" },
  { id: "amber", label: "Amber", group: "color", mode: "dark", hue: 28, bgSat: 40, swatch: "#ff8f1f" },
  { id: "rose", label: "Rose", group: "color", mode: "dark", hue: 340, bgSat: 38, swatch: "#ff3d77" },
  { id: "teal", label: "Teal", group: "color", mode: "dark", hue: 184, bgSat: 40, swatch: "#06f9e4" },
  { id: "lime", label: "Lime", group: "color", mode: "dark", hue: 78, bgSat: 28, swatch: "#b9f924" },
];

export const DEFAULT_THEME = "dark";
export const THEME_STORAGE_KEY = "lookout-theme";

export function isThemeId(value: string | null): value is string {
  return !!value && THEMES.some((t) => t.id === value);
}
