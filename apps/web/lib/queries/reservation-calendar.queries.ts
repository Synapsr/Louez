import { orpc } from "@/lib/orpc/react";

import {
  chunkRange,
  getChunkIndices,
  initialTimelineWindow,
  TIMELINE_STALE_TIME,
} from "./util.timeline-chunks";

const chunk = (storeId: string, index: number) => {
  const { start, end } = chunkRange(index);

  return orpc.dashboard.reservations.calendarPeriod.queryOptions({
    input: {
      storeId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    staleTime: TIMELINE_STALE_TIME,
  });
};

export const reservationCalendarQueries = {
  initialWindow: initialTimelineWindow,
  forWindow: (storeId: string, windowStart: Date, daysCount: number) =>
    getChunkIndices(windowStart, daysCount).map((index) => chunk(storeId, index)),
  initial: (storeId: string, anchorDate = new Date()) => {
    const window = initialTimelineWindow(anchorDate);
    return reservationCalendarQueries.forWindow(storeId, window.start, window.daysCount);
  },
  key: () => orpc.dashboard.reservations.calendarPeriod.key(),
};
