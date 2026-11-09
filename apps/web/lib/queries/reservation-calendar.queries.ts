import { orpc } from "@/lib/orpc/react";

import {
  chunkRange,
  getChunkIndices,
  initialTimelineWindow,
  TIMELINE_STALE_TIME,
} from "./util.timeline-chunks";

const chunk = (index: number) => {
  const { start, end } = chunkRange(index);

  // The session's current store; switching stores reloads the page and its cache.
  return orpc.dashboard.reservations.listCalendarPeriod.queryOptions({
    input: { from: start, to: end },
    select: (page) => page.items,
    staleTime: TIMELINE_STALE_TIME,
  });
};

export const reservationCalendarQueries = {
  initialWindow: initialTimelineWindow,
  forWindow: (windowStart: Date, daysCount: number) =>
    getChunkIndices(windowStart, daysCount).map((index) => chunk(index)),
  initial: (anchorDate = new Date()) => {
    const window = initialTimelineWindow(anchorDate);
    return reservationCalendarQueries.forWindow(window.start, window.daysCount);
  },
  key: () => orpc.dashboard.reservations.listCalendarPeriod.key(),
};
