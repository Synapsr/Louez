/**
 * Up to this many overdue reservations, each gets its row; past it, they read
 * as one line per kind that opens the reservations list, filtered. Two rows
 * keep the block small next to the day's agenda; a third already reads as a
 * list to work through, which the reservations page does better.
 */
export const OVERDUE_ROWS_MAX = 2;

export interface OverdueKindSummary {
  count: number;
  /** When the oldest of them should have happened; null when none. */
  oldestDueAt: Date | null;
}

export interface OverdueSummary {
  total: number;
  /** "rows" lists each one, "grouped" sums them up per kind. */
  display: "rows" | "grouped";
  returns: OverdueKindSummary;
  departures: OverdueKindSummary;
  /** The oldest of all, whatever its kind; null when none. */
  oldestDueAt: Date | null;
}

export const getOverdueSummary = <
  Row extends { overdueKind: "departure" | "return"; dueAt: Date },
>({
  rows,
  overdueReturns,
  overdueDepartures,
}: {
  /** The oldest overdue rows, oldest first in each kind. */
  rows: Row[];
  overdueReturns: number;
  overdueDepartures: number;
}): OverdueSummary => {
  const oldest = (kind: Row["overdueKind"]) =>
    rows.find((row) => row.overdueKind === kind)?.dueAt ?? null;
  const total = overdueReturns + overdueDepartures;

  return {
    total,
    display: total > OVERDUE_ROWS_MAX ? "grouped" : "rows",
    returns: { count: overdueReturns, oldestDueAt: oldest("return") },
    departures: { count: overdueDepartures, oldestDueAt: oldest("departure") },
    oldestDueAt:
      rows.length === 0 ? null : new Date(Math.min(...rows.map((row) => row.dueAt.getTime()))),
  };
};
