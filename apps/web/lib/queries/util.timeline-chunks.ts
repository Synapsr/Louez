export const CHUNK_DAYS = 28;
export const TIMELINE_STALE_TIME = 30_000;

const CHUNK_EPOCH = new Date(2024, 0, 1);
const INITIAL_PAST_DAYS = 28;
const INITIAL_DAYS_COUNT = 84;
const MS_PER_DAY = 86_400_000;

const startOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const diffInDays = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);

const getMondayOf = (date: Date) => {
  const result = startOfDay(date);
  const day = result.getDay();
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day));
  return result;
};

export function getChunkIndices(windowStart: Date, daysCount: number): number[] {
  const first = Math.floor(diffInDays(CHUNK_EPOCH, windowStart) / CHUNK_DAYS);
  const last = Math.floor(
    diffInDays(CHUNK_EPOCH, addDays(windowStart, daysCount - 1)) / CHUNK_DAYS,
  );

  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** Chunk boundaries are a pure function of the index (local time), so a given
 * chunk always serializes to the same query input, hence the same query key. */
export function chunkRange(index: number): { start: Date; end: Date } {
  const start = addDays(CHUNK_EPOCH, index * CHUNK_DAYS);
  const end = addDays(start, CHUNK_DAYS - 1);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function initialTimelineWindow(anchorDate: Date): { start: Date; daysCount: number } {
  return {
    start: getMondayOf(addDays(anchorDate, -INITIAL_PAST_DAYS)),
    daysCount: INITIAL_DAYS_COUNT,
  };
}
