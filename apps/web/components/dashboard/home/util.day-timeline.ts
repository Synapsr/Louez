import type { HomeReservation } from "./home-types";

export interface TimelineEvent {
  kind: "departure" | "return";
  at: Date;
  reservation: HomeReservation;
  /** Row of the chip, so that close events never overlap. */
  lane: number;
}

const LANE_COUNT = 3;
/** Two chips on the same row stay at least this many hours apart. */
const MIN_GAP_HOURS = 1.6;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;

const hourOf = (date: Date) => date.getHours() + date.getMinutes() / 60;

/**
 * Orders today's events in time and gives each a lane: the first row where it
 * keeps its distance from the previous chip. The window is 8 h – 20 h,
 * stretched to the even hours around any event outside it.
 */
export function placeTimelineEvents({
  departures,
  returns,
}: {
  departures: HomeReservation[];
  returns: HomeReservation[];
}): { events: TimelineEvent[]; startHour: number; endHour: number } {
  const sorted = [
    ...departures.map((reservation) => ({ kind: "departure" as const, at: reservation.startDate, reservation })),
    ...returns.map((reservation) => ({ kind: "return" as const, at: reservation.endDate, reservation })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const lastInLane: number[] = Array.from({ length: LANE_COUNT }, () => Number.NEGATIVE_INFINITY);
  const events = sorted.map((event, index) => {
    const hour = hourOf(event.at);
    const free = lastInLane.findIndex((last) => hour - last >= MIN_GAP_HOURS);
    const lane = free === -1 ? index % LANE_COUNT : free;
    lastInLane[lane] = hour;
    return { ...event, lane };
  });

  const hours = events.map((event) => hourOf(event.at));
  const earliest = Math.min(DEFAULT_START_HOUR, ...hours);
  const latest = Math.max(DEFAULT_END_HOUR, ...hours);
  const startHour = Math.max(0, Math.floor(earliest / 2) * 2);
  const endHour = Math.min(24, Math.ceil((latest + 0.01) / 2) * 2);

  return { events, startHour, endHour };
}
