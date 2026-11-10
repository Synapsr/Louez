import { z } from "zod";

import { resourceLinksSchema } from "./links";

/**
 * The statistics contract: the figures of the dashboard's home and of its
 * sales pages, as agents and the API read them. No database here.
 */

/** The rolling periods of the dashboard's analytics filter. */
export const ANALYTICS_PERIODS = ["7d", "30d", "90d", "6m", "12m"] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

/** The period a window falls back to. */
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = "30d";

/** The longest custom range a report covers, in days. */
export const ANALYTICS_RANGE_MAX_DAYS = 731;

/** Most products `analytics.getProductPerformance` ranks, and its default. */
export const PRODUCT_PERFORMANCE_MAX = 50;
export const PRODUCT_PERFORMANCE_DEFAULT = 10;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a calendar date.");

const DAY_MS = 86_400_000;

const windowFields = {
  period: z
    .enum(ANALYTICS_PERIODS)
    .optional()
    .describe(
      "A rolling period of the dashboard's filter, ending now: 7d, 30d and 90d start at midnight 6, 29 and 89 days ago; 6m and 12m start on the first day of the month 5 and 11 months ago. Default 30d. Leave it out when you send startDate and endDate.",
    ),
  startDate: isoDate
    .optional()
    .describe(
      "First day of a custom range, YYYY-MM-DD, in the store's time zone. Send it with endDate.",
    ),
  endDate: isoDate
    .optional()
    .describe(
      "Last day of a custom range, YYYY-MM-DD, included, in the store's time zone. A range ends at the time of the call at the latest.",
    ),
};

type WindowFields = { period?: AnalyticsPeriod; startDate?: string; endDate?: string };

/** Either a period or a custom range of at most ANALYTICS_RANGE_MAX_DAYS days. */
function checkWindow(input: WindowFields, issues: z.RefinementCtx) {
  const { period, startDate, endDate } = input;
  if ((startDate === undefined) !== (endDate === undefined)) {
    issues.addIssue({ code: "custom", message: "Send startDate and endDate together." });
    return;
  }
  if (startDate === undefined || endDate === undefined) return;
  if (period !== undefined) {
    issues.addIssue({ code: "custom", message: "Send a period or a date range, not both." });
    return;
  }
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / DAY_MS;
  if (days < 0) {
    issues.addIssue({ code: "custom", message: "endDate is before startDate." });
  } else if (days + 1 > ANALYTICS_RANGE_MAX_DAYS) {
    issues.addIssue({
      code: "custom",
      message: `A range covers ${ANALYTICS_RANGE_MAX_DAYS} days at most.`,
    });
  }
}

/** The window a report covers, as the store's time zone and the call's time set it. */
const reportWindowSchema = z.object({
  /** The rolling period asked, or null for a custom range. */
  period: z.enum(ANALYTICS_PERIODS).nullable(),
  start: z.date().describe("Start of the window, included."),
  end: z.date().describe("End of the window, excluded: the time of the call at the latest."),
  previousStart: z
    .date()
    .describe(
      "Start of the window of the same length right before, which the growth compares with.",
    ),
  timezone: z
    .string()
    .describe("The store's time zone, which sets midnight and the first of the month."),
});

const money = z.string().describe('A decimal amount in `currency`, such as "120.50".');
const growth = z
  .number()
  .nullable()
  .describe(
    "Change against the window of the same length right before, in percent; null when that window had none.",
  );

// --- analytics.getDashboardStats ------------------------------------------------

export const getDashboardStatsInput = z.object({});

export const getDashboardStatsOutput = z.object({
  currency: z.string().describe("The store's currency, ISO 4217."),
  timezone: z.string().describe("The store's time zone, which sets today and the month."),
  today: z.object({
    start: z.date(),
    end: z.date().describe("Next midnight, excluded."),
    revenue: money.describe("Rental payments received today, by the time of the call."),
    departures: z.number().int().describe("Confirmed reservations that start today."),
    returns: z.number().int().describe("Ongoing reservations due back today."),
  }),
  revenue: z.object({
    monthStart: z.date(),
    monthToDate: money.describe("Rental payments received since the first of the month."),
    lastMonth: money.describe("Rental payments received over the whole previous month."),
    allTime: money.describe("Rental payments received since the store opened."),
  }),
  reservations: z.object({
    total: z
      .number()
      .int()
      .describe("Every reservation of the store, quotes and cancellations included."),
    pending: z.number().int().describe("Requests waiting for the store's answer."),
    confirmed: z.number().int(),
    ongoing: z.number().int().describe("Rentals out with the customer."),
    completed: z.number().int(),
  }),
  catalog: z.object({
    products: z.number().int(),
    activeProducts: z.number().int(),
    draftProducts: z.number().int(),
  }),
  customers: z.object({
    total: z.number().int(),
    newThisMonth: z.number().int().describe("Customers added since the first of the month."),
  }),
  links: resourceLinksSchema,
});
export type DashboardStats = z.infer<typeof getDashboardStatsOutput>;

// --- analytics.getRevenueReport -------------------------------------------------

export const getRevenueReportInput = z.object(windowFields).superRefine(checkWindow);

export const getRevenueReportOutput = z.object({
  currency: z.string().describe("The store's currency, ISO 4217."),
  window: reportWindowSchema,
  revenue: money.describe(
    "Rental payments received over the window, every payment method, counted on the day they were cashed in. Deposits and refunds are left out.",
  ),
  revenueGrowth: growth,
  paymentCount: z.number().int(),
  averagePayment: money,
  reservations: z
    .number()
    .int()
    .describe("Reservations that start over the window: pending, confirmed, ongoing or completed."),
  reservationsGrowth: growth,
  byPaymentMethod: z.array(
    z.object({
      method: z.string().describe("stripe, cash, card, transfer, check or other."),
      revenue: money,
      paymentCount: z.number().int(),
    }),
  ),
  breakdown: z
    .array(
      z.object({
        start: z.date(),
        end: z.date(),
        revenue: money,
        paymentCount: z.number().int(),
      }),
    )
    .describe("The revenue per day, or per month for a window longer than 92 days."),
  links: resourceLinksSchema,
});
export type RevenueReport = z.infer<typeof getRevenueReportOutput>;

// --- analytics.getProductPerformance --------------------------------------------

export const getProductPerformanceInput = z
  .object({
    ...windowFields,
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PRODUCT_PERFORMANCE_MAX)
      .optional()
      .describe(
        `Products to rank, ${PRODUCT_PERFORMANCE_DEFAULT} by default, ${PRODUCT_PERFORMANCE_MAX} at most.`,
      ),
  })
  .superRefine(checkWindow);

export const getProductPerformanceOutput = z.object({
  currency: z.string().describe("The store's currency, ISO 4217."),
  window: reportWindowSchema,
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      revenue: money.describe(
        "The product's share of the rental payments received over the window: each reservation's payments are split across its items in proportion to their price.",
      ),
      quantity: z
        .number()
        .int()
        .describe("Units booked, over the reservations that brought those payments."),
      reservations: z
        .number()
        .int()
        .describe("Reservations of the product that brought those payments."),
      links: resourceLinksSchema,
    }),
  ),
  productCount: z
    .number()
    .int()
    .describe("Products that brought payments over the window, ranked or not."),
  revenue: money.describe(
    "Rental payments received over the window, as get_revenue_report counts them.",
  ),
  catalogRevenue: money.describe(
    "The part of `revenue` that went to the store's products, ranked or not.",
  ),
  nonCatalogRevenue: money.describe(
    "The part that went to items outside the catalog (a custom line, a deleted product).",
  ),
  unallocatedRevenue: money.describe(
    "The part paid on reservations whose items have no price to split it by.",
  ),
  links: resourceLinksSchema,
});
export type ProductPerformance = z.infer<typeof getProductPerformanceOutput>;
