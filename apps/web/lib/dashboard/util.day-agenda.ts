/** A hand-over or a return on the day's agenda. */
export interface AgendaEntry<Reservation> {
  kind: "departure" | "return";
  at: Date;
  reservation: Reservation;
}

export interface DayAgenda<Reservation> {
  entries: AgendaEntry<Reservation>[];
  /**
   * Where "now" falls: the index of the first entry still to come. 0 when
   * everything is ahead, `entries.length` when the day is behind us.
   */
  nowIndex: number;
}

/**
 * The day's hand-overs and returns as one chronological agenda. Departures and
 * returns share a list: what the owner needs is what comes next, whatever its
 * direction. At the same minute a return comes first, since the gear it brings
 * back may be what leaves next.
 */
export const buildDayAgenda = <Reservation extends { startDate: Date; endDate: Date }>({
  departures,
  returns,
  now,
}: {
  departures: Reservation[];
  returns: Reservation[];
  now: Date;
}): DayAgenda<Reservation> => {
  const entries: AgendaEntry<Reservation>[] = [
    ...departures.map((reservation) => ({
      kind: "departure" as const,
      at: reservation.startDate,
      reservation,
    })),
    ...returns.map((reservation) => ({
      kind: "return" as const,
      at: reservation.endDate,
      reservation,
    })),
  ].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() || (a.kind === b.kind ? 0 : a.kind === "return" ? -1 : 1),
  );
  const firstAhead = entries.findIndex((entry) => entry.at >= now);

  return { entries, nowIndex: firstAhead === -1 ? entries.length : firstAhead };
};
