import type { OnlineStoreDevice } from "../online-store.constants";

/**
 * The sketch has its own palette rather than the page tokens: the store's
 * mode is not the dashboard's, so a light store must read light inside a
 * dark dashboard and the other way round. Text is drawn as light grey bars
 * rather than ink: the sketch should read as a quiet miniature, not as a
 * page of black lines.
 */
export const SKETCH_PALETTE = {
  light: {
    page: "bg-white text-zinc-900",
    chrome: "bg-zinc-50 text-zinc-400 border-zinc-200/70",
    line: "border-zinc-200/70",
    band: "bg-zinc-50",
    surface: "bg-white",
    ink: "bg-zinc-300",
    inkSoft: "bg-zinc-200",
    text: "text-zinc-900",
    textSoft: "text-zinc-500",
    fill: "bg-zinc-100",
    fillSoft: "bg-zinc-50",
    icon: "text-zinc-300",
  },
  dark: {
    page: "bg-zinc-950 text-zinc-100",
    chrome: "bg-zinc-900 text-zinc-500 border-zinc-800",
    line: "border-zinc-800",
    band: "bg-zinc-900",
    surface: "bg-zinc-900",
    ink: "bg-zinc-600",
    inkSoft: "bg-zinc-700",
    text: "text-zinc-100",
    textSoft: "text-zinc-400",
    fill: "bg-zinc-800",
    fillSoft: "bg-zinc-900",
    icon: "text-zinc-600",
  },
} as const;

export type SketchPalette = (typeof SKETCH_PALETTE)[keyof typeof SKETCH_PALETTE];

/** Page transition and layout moves share one curve; zero under reduced motion. */
export const SKETCH_TRANSITION = { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const };

/**
 * The sketch is drawn at the storefront's own sizes on a reference viewport,
 * then zoomed to the space available. A desktop viewport is the width of
 * the site's content container (`max-w-7xl`), so the page renders exactly
 * as it does on a laptop; the phone is an iPhone-sized viewport.
 */
export const SKETCH_DESIGN_WIDTH: Record<OnlineStoreDevice, number> = {
  desktop: 1280,
  phone: 390,
};

/** Thickness of the drawn phone bezel, outside the viewport: a 3 px metal band and a 9 px black border. */
export const SKETCH_PHONE_BEZEL = 12;

/** The phone viewport's height, an iPhone's 390 × 844. The page scrolls inside it. */
export const SKETCH_PHONE_SCREEN_HEIGHT = 844;
