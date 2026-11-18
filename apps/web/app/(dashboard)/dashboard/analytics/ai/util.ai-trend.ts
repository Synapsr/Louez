import type { AiTrafficView } from "@louez/api/contracts/ai-visibility";

import type { TrendDataPoint } from "../trend-chart";

/**
 * The AI sources series as the traffic chart draws it: visits from
 * assistants as its visitors line, the reservations made during them as its
 * conversions line, each bucket labelled at the store's own midnight.
 */
export function toAiTrendPoints(
  view: Pick<AiTrafficView, "series" | "granularity" | "timezone">,
  intlLocale: string,
): TrendDataPoint[] {
  const label = new Intl.DateTimeFormat(intlLocale, {
    timeZone: view.timezone,
    ...(view.granularity === "month"
      ? { month: "short", year: "2-digit" }
      : { day: "2-digit", month: "2-digit" }),
  });
  return view.series.map((point) => ({
    date: point.start.toISOString(),
    label: label.format(point.start),
    visitors: point.visits,
    pageViews: point.visits,
    conversions: point.bookings,
  }));
}

/** Change against the period before, in percent; null when there was nothing before. */
export const percentChange = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

/** The visits from assistants, as a share of every visit, in percent; null without visits. */
export const shareOf = (part: number, all: number): number | null =>
  all > 0 ? Math.round((part / all) * 1000) / 10 : null;
