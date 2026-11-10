import { addStoreDays, storeDayKey } from "./util.store-day";

/** Reservations that make a day's hand-overs and returns: everything not dropped. */
const ACTIVE_STATUSES = new Set(["confirmed", "ongoing", "completed"]);

interface DatedReservation {
  status: string | null;
  startDate: Date;
  endDate: Date;
}

/**
 * The hand-overs and returns of one store-calendar day, from the reservations
 * of a period: a departure starts that day, a return ends that day. Requests
 * not yet accepted and cancelled bookings make neither.
 */
export const splitDay = <Reservation extends DatedReservation>(
  reservations: Reservation[],
  dayKey: string,
  timezone: string,
): { departures: Reservation[]; returns: Reservation[] } => {
  const active = reservations.filter((reservation) =>
    ACTIVE_STATUSES.has(reservation.status ?? ""),
  );
  return {
    departures: active.filter(
      (reservation) => storeDayKey(reservation.startDate, timezone) === dayKey,
    ),
    returns: active.filter((reservation) => storeDayKey(reservation.endDate, timezone) === dayKey),
  };
};

interface NextActivity {
  date: Date;
  departures: number;
  returns: number;
}

/**
 * The first day after `afterKey`, up to `untilKey` included, with a hand-over
 * or a return, and how many of each. Past `untilKey` the reservations may not
 * all be loaded, so nothing there is trusted.
 */
export const findNextActivity = <Reservation extends DatedReservation>(
  reservations: Reservation[],
  afterKey: string,
  untilKey: string,
  timezone: string,
): NextActivity | null => {
  let first: { key: string; at: Date } | null = null;
  for (const reservation of reservations) {
    if (!ACTIVE_STATUSES.has(reservation.status ?? "")) continue;
    for (const at of [reservation.startDate, reservation.endDate]) {
      const key = storeDayKey(at, timezone);
      if (key <= afterKey || key > untilKey) continue;
      if (!first || key < first.key) first = { key, at };
    }
  }
  if (!first) return null;
  const { departures, returns } = splitDay(reservations, first.key, timezone);
  return {
    date: addStoreDays(first.at, 0, timezone),
    departures: departures.length,
    returns: returns.length,
  };
};
