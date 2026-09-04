"use client";

import { useQueryState } from "nuqs";

import { calendarDateParser } from "./calendar-query";

/**
 * Reads and writes the `date` search param shared by both timeline views.
 *
 * `history: "replace"` keeps scrolling through time out of the browser's back
 * stack — one back press should leave the timeline, not rewind it day by day.
 */
export function useTimelineDateParam() {
  return useQueryState("date", calendarDateParser.withOptions({ history: "replace" }));
}
