import type { orpcClient } from "@/lib/orpc/client";
import { orpc } from "@/lib/orpc/react";

import {
  TIMELINE_STALE_TIME,
  chunkRange,
  getChunkIndices,
  initialTimelineWindow,
} from "./util.timeline-chunks";

/** One raw (reservation, product) row as the planning timeline procedure returns it. */
export type PlanningTimelineEntry = Awaited<
  ReturnType<typeof orpcClient.dashboard.reservations.planningTimeline>
>[number];

/**
 * One cached query per fixed 28-day chunk. Chunk boundaries only depend on the
 * index, so the same calendar days always serialize to the same query input —
 * and therefore the same cache entry, whichever window is currently on screen.
 */
const chunk = (storeId: string, index: number) => {
  const { start, end } = chunkRange(index);

  return orpc.dashboard.reservations.planningTimeline.queryOptions({
    input: {
      storeId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    staleTime: TIMELINE_STALE_TIME,
  });
};

export const reservationPlanningQueries = {
  initialWindow: initialTimelineWindow,
  forWindow: (storeId: string, windowStart: Date, daysCount: number) =>
    getChunkIndices(windowStart, daysCount).map((index) => chunk(storeId, index)),
  key: () => orpc.dashboard.reservations.planningTimeline.key(),
};
