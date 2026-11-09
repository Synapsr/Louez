/**
 * Lagon popup recipe, shared by every floating list: menus (dropdowns),
 * selects, comboboxes, autocompletes and popovers. One surface, one row, one
 * group label, one separator — a dropdown reads the same wherever it opens.
 *
 * Surface: the "flottant" elevation (its shadow carries the hairline edge, so
 * no border), 14px corners like a card. Rows: 10px corners like the other
 * controls, a 36px touch-friendly height (32px on desktop), the Lagon-50 wash
 * when highlighted, and the selected entry in primary ink with a tick.
 *
 * Motion answers the open: the popup grows out of its trigger (transform
 * origin) with a fade, 150ms in and 100ms out — closing is never waited on.
 */

/** The floating surface itself. */
export const POPUP_SURFACE =
  "bg-popover text-popover-foreground rounded-[14px] border-0 shadow-overlay outline-none";

/** Open / close transition for an element that receives Base UI's
 *  `data-starting-style` / `data-ending-style` itself. */
export const POPUP_MOTION =
  "origin-(--transform-origin) transition-[scale,opacity] duration-150 ease-lagon data-starting-style:scale-97 data-starting-style:opacity-0 data-ending-style:scale-97 data-ending-style:opacity-0 data-ending-style:duration-100 motion-reduce:transition-opacity motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100";

/** The same transition for a wrapper whose child popup carries the states. */
export const POPUP_WRAPPER_MOTION =
  "origin-(--transform-origin) transition-[scale,opacity] duration-150 ease-lagon has-[[data-starting-style]]:scale-97 has-[[data-starting-style]]:opacity-0 has-[[data-ending-style]]:scale-97 has-[[data-ending-style]]:opacity-0 motion-reduce:transition-opacity motion-reduce:has-[[data-starting-style]]:scale-100 motion-reduce:has-[[data-ending-style]]:scale-100";

/** One row of a list. Highlight = keyboard or pointer, same wash. */
export const POPUP_ITEM =
  "relative flex min-h-9 sm:min-h-8 cursor-default select-none items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-sm font-medium text-foreground/85 outline-none transition-colors duration-100 ease-lagon data-highlighted:bg-accent data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-highlighted:[&_svg:not([class*='text-'])]:text-foreground";

/** The chosen entry of a select or combobox (Base UI `data-selected`). */
export const POPUP_ITEM_SELECTED = "data-selected:text-primary data-selected:font-semibold";

/** The tick next to a chosen entry. It draws itself when it appears. */
export const POPUP_INDICATOR =
  "text-primary [&_path]:[stroke-dasharray:24] [&_path]:animate-draw [&_svg]:size-4";

export const POPUP_GROUP_LABEL =
  "px-2.5 pt-2 pb-1 text-[11px] font-bold tracking-[0.06em] uppercase text-muted-foreground";

export const POPUP_SEPARATOR = "mx-1.5 my-1 h-px bg-border/70";
