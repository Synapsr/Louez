/**
 * One colour language for seasonal rates.
 *
 * A season is always a coloured bar — under a calendar day, in the picker
 * legend, in the rate list and in the price split. Selection keeps the
 * background to itself, so "the dates I picked" and "the rate that applies"
 * never compete for the same signal.
 */

export const SEASON_TONE_COUNT = 4;

/** Days outside every season: the standard rate, drawn as a neutral bar. */
export const SEASON_BASE_TONE_CLASS = "bg-muted-foreground/40";

const SEASON_TONE_CLASSES = ["bg-season-1", "bg-season-2", "bg-season-3", "bg-season-4"] as const;

/** Marker placed under a calendar day, above the selected-range fill. */
const SEASON_DAY_MARKER =
  "after:pointer-events-none after:absolute after:inset-x-1.5 after:bottom-1 after:z-20 after:h-1 after:rounded-full";

export const SEASON_DAY_CLASSES = [
  `${SEASON_DAY_MARKER} after:bg-season-1`,
  `${SEASON_DAY_MARKER} after:bg-season-2`,
  `${SEASON_DAY_MARKER} after:bg-season-3`,
  `${SEASON_DAY_MARKER} after:bg-season-4`,
] as const;

/** `null` is the standard rate; any other rank wraps around the palette. */
export const seasonToneClass = (toneIndex: number | null | undefined): string =>
  toneIndex === null || toneIndex === undefined
    ? SEASON_BASE_TONE_CLASS
    : SEASON_TONE_CLASSES[toneIndex % SEASON_TONE_COUNT];
