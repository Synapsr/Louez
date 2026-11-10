import {
  ANALYTICS_PERIODS,
  DEFAULT_ANALYTICS_PERIOD,
  type AnalyticsPeriod,
} from "@louez/api/contracts/analytics";
import { isAnalyticsPeriod } from "@louez/api/services/sales-window";

/**
 * Period vocabulary shared by the analytics routes: the filter in the layout
 * writes `?period=`, both sub-pages read it back to size their queries. The
 * periods and their windows are the statistics procedures' own
 * (packages/api), so agents count over the same days.
 */
export type Period = AnalyticsPeriod;

export const PERIODS: readonly Period[] = ANALYTICS_PERIODS;

export { getPeriodConfig } from "@louez/api/services/sales-window";

/** `?period=` is user input — anything unknown falls back to the default window. */
export const parsePeriod = (value: string | undefined): Period =>
  isAnalyticsPeriod(value) ? value : DEFAULT_ANALYTICS_PERIOD;
