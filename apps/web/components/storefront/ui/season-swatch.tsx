import { cn } from "@louez/utils";

import { seasonToneClass } from "./season-tone.constants";

/** The bar that names a season, matching its marker in the calendar. */
export const SeasonSwatch = ({
  toneIndex,
  className,
}: {
  toneIndex: number | null;
  className?: string;
}) => (
  <span
    aria-hidden
    className={cn("h-1 w-4 shrink-0 rounded-full", seasonToneClass(toneIndex), className)}
  />
);
