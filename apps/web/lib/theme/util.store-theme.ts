/**
 * Store theme → CSS variables, computed on the server so the first paint
 * already carries the tenant's primary colour (no platform-blue flash).
 *
 * The conversion mirrors what `theme-wrapper.tsx` did in a `useEffect`:
 * same OKLCH maths, same rounding, same contrast threshold, so swapping the
 * client effect for an inline `<style>` changes nothing on screen.
 */

export type StoreThemeMode = "light" | "dark";

export interface StoreThemeInput {
  mode: StoreThemeMode;
  primaryColor: string;
}

/** Theme of a store that never picked one: light, platform blue. */
export const DEFAULT_STORE_THEME: StoreThemeInput = { mode: "light", primaryColor: "#0066FF" };

/**
 * `theme-color` of the viewport meta per mode. `dark` is the hex form of
 * the `.dark { --background }` token in `globals.css` (oklch(0.145 0 0)),
 * so the browser chrome matches the page behind it.
 */
export const STORE_THEME_VIEWPORT_COLORS: Record<StoreThemeMode, string> = {
  light: "#ffffff",
  dark: "#0a0a0a",
};

export interface StoreThemeVariables {
  "--primary": string;
  "--primary-foreground": string;
  "--ring": string;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const HEX_PATTERN = /^#?([\da-f]{3}|[\da-f]{6})$/i;

/** Parses `#rgb` / `#rrggbb` (hash optional) into 0–255 channels. */
export const parseHexColor = (hexColor: string): RgbColor | null => {
  const match = hexColor.trim().match(HEX_PATTERN);
  const digits = match?.[1];

  if (!digits) {
    return null;
  }

  const expanded =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
};

const srgbToLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);

/**
 * sRGB hex → `oklch(L C H)` string for Tailwind v4 tokens.
 * Returns `null` for anything that is not a 3- or 6-digit hex colour.
 */
export const hexToOklch = (hexColor: string): string | null => {
  const rgb = parseHexColor(hexColor);

  if (!rgb) {
    return null;
  }

  const lr = srgbToLinear(rgb.r / 255);
  const lg = srgbToLinear(rgb.g / 255);
  const lb = srgbToLinear(rgb.b / 255);

  // Linear sRGB → XYZ (D65)
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb;

  // XYZ → LMS (OKLab M1)
  const l = 0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z;
  const m = 0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z;
  const s = 0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // LMS' → OKLab (M2)
  const lightness = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const chroma = Math.sqrt(a * a + b * b);
  const hueRaw = Math.atan2(b, a) * (180 / Math.PI);
  const hue = hueRaw < 0 ? hueRaw + 360 : hueRaw;

  return `oklch(${lightness.toFixed(3)} ${chroma.toFixed(3)} ${hue.toFixed(1)})`;
};

const DARK_FOREGROUND = "oklch(0.205 0 0)";
const LIGHT_FOREGROUND = "oklch(0.985 0 0)";

/**
 * Text colour that reads on the given background: near-black above the
 * 0.55 luma threshold, near-white below it. The threshold favours white on
 * medium tones (pink, purple, teal) where 0.5 would flip to black too soon.
 */
export const getContrastForeground = (hexColor: string): string | null => {
  const rgb = parseHexColor(hexColor);

  if (!rgb) {
    return null;
  }

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;

  return luminance > 0.55 ? DARK_FOREGROUND : LIGHT_FOREGROUND;
};

/**
 * The three variables a store overrides. `null` when the stored colour is
 * unusable, so callers fall back to the platform palette instead of
 * emitting `oklch(NaN …)`.
 */
export const getStoreThemeVariables = (theme: StoreThemeInput): StoreThemeVariables | null => {
  const primary = hexToOklch(theme.primaryColor);
  const primaryForeground = getContrastForeground(theme.primaryColor);

  if (!primary || !primaryForeground) {
    return null;
  }

  return {
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    "--ring": primary,
  };
};

/**
 * CSS text for an inline `<style>` rendered by the storefront layout.
 *
 * Targets `:root`, `.dark` and `.light` together: the palette blocks in
 * `globals.css` redefine `--primary` under each of those selectors, and the
 * tenant colour has to win in every mode. Render the tag after the global
 * stylesheet (anywhere in `<body>` does), as the tie on specificity is
 * broken by source order. Empty string when the colour is invalid.
 */
export const buildStoreThemeStyle = (theme: StoreThemeInput): string => {
  const variables = getStoreThemeVariables(theme);

  if (!variables) {
    return "";
  }

  const declarations = Object.entries(variables)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");

  return `:root,.dark,.light{${declarations}}`;
};

/** Class the theme root carries; `.dark` flips every token in `globals.css`. */
export const getStoreThemeClassName = (mode: StoreThemeMode): "dark" | undefined =>
  mode === "dark" ? "dark" : undefined;
