import type { PartnerStatement } from "@louez/api/contracts/partners";

import { generateCsv } from "@/lib/export/csv";

/** The column titles and state names, in the dashboard's language. */
export interface PartnerCsvLabels {
  headers: {
    number: string;
    startDate: string;
    endDate: string;
    base: string;
    rule: string;
    commission: string;
    state: string;
    note: string;
  };
  states: Record<PartnerStatement["bookings"][number]["state"], string>;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * A month's statement as CSV, for the store's books: one line per
 * reservation, amounts as plain numbers (dot decimals) in the statement's
 * currency, which the base column names.
 */
export function buildPartnerStatementCsv(
  statement: Pick<PartnerStatement, "bookings" | "currency">,
  labels: PartnerCsvLabels,
): string {
  const { headers } = labels;
  return generateCsv(
    [
      headers.number,
      headers.startDate,
      headers.endDate,
      `${headers.base} (${statement.currency})`,
      headers.rule,
      `${headers.commission} (${statement.currency})`,
      headers.state,
      headers.note,
    ],
    statement.bookings.map((booking) => [
      booking.number,
      isoDate(booking.startDate),
      isoDate(booking.endDate),
      booking.base.toFixed(2),
      booking.rule.type === "percent" ? `${booking.rule.value} %` : booking.rule.value.toFixed(2),
      (booking.state === "cancelled" ? 0 : booking.commission).toFixed(2),
      labels.states[booking.state],
      booking.adjustment?.note ?? "",
    ]),
  );
}

/** `<partner code>-<month>.csv`, e.g. `camping-les-pins-2026-11.csv`. */
export const partnerStatementFileName = (code: string, month: string): string =>
  `${code}-${month}.csv`;
