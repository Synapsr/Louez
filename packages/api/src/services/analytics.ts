import {
  DEFAULT_ANALYTICS_PERIOD,
  PRODUCT_PERFORMANCE_DEFAULT,
  type AnalyticsPeriod,
  type DashboardStats,
  type ProductPerformance,
  type RevenueReport,
} from "../contracts/analytics";
import {
  getOtherCurrencyReceipts,
  getPeriodReservationStats,
  getRevenueByPaymentMethod,
  getRevenueTimeSeries,
  getSalesPaymentStats,
  getTopProductsByRevenue,
  salesStore,
  type OtherCurrencyReceipts,
} from "./sales-analytics";
import { getSalesWindow, getSalesWindowForDates, type SalesWindow } from "./sales-window";
import { getStoreMetrics } from "./store-metrics";

/**
 * The statistics procedures' answers, from the queries the dashboard's home
 * and sales pages run: the same records, the same definitions, live. Links
 * are added by the router.
 */

/** What the figures need from the store. */
export interface AnalyticsStore {
  id: string;
  settings: { timezone?: string | null; currency?: string | null } | null;
}

export interface AnalyticsWindowInput {
  period?: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
}

const amount = (value: number) => value.toFixed(2);

/** What the totals left out, in its own currency. */
const otherCurrenciesOutput = (receipts: OtherCurrencyReceipts[]) =>
  receipts.map((receipt) => ({
    currency: receipt.currency,
    amount: amount(receipt.amount),
    paymentCount: receipt.paymentCount,
  }));

/** The window of a report: the custom range when given, else the rolling period. */
export function analyticsWindow(
  store: AnalyticsStore,
  input: AnalyticsWindowInput,
  now: Date,
): { window: SalesWindow; period: AnalyticsPeriod | null } {
  const timezone = store.settings?.timezone ?? "UTC";
  if (input.startDate && input.endDate) {
    return {
      window: getSalesWindowForDates(input.startDate, input.endDate, now, timezone),
      period: null,
    };
  }
  const period = input.period ?? DEFAULT_ANALYTICS_PERIOD;
  return { window: getSalesWindow(period, now, timezone), period };
}

const windowOutput = (window: SalesWindow, period: AnalyticsPeriod | null) => ({
  period,
  start: window.start,
  end: window.end,
  previousStart: window.previousStart,
  timezone: window.timezone,
});

export async function dashboardStats(
  store: AnalyticsStore,
  now = new Date(),
): Promise<Omit<DashboardStats, "links">> {
  const sales = salesStore(store);
  const [metrics, others] = await Promise.all([
    getStoreMetrics(sales, { timezone: store.settings?.timezone, now }),
    getOtherCurrencyReceipts(sales, { end: now }),
  ]);
  const { calendar } = metrics;
  return {
    currency: sales.currency,
    timezone: calendar.timezone,
    today: {
      start: calendar.todayStart,
      end: calendar.tomorrowStart,
      revenue: amount(metrics.todaysRevenue),
      departures: metrics.todaysDepartures,
      returns: metrics.todaysReturns,
    },
    revenue: {
      monthStart: calendar.monthStart,
      monthToDate: amount(metrics.monthlyRevenue),
      lastMonth: amount(metrics.lastMonthRevenue),
      allTime: amount(metrics.allTimeRevenue),
    },
    otherCurrencies: otherCurrenciesOutput(others),
    reservations: {
      total: metrics.totalReservations,
      pending: metrics.pendingReservations,
      confirmed: metrics.confirmedReservations,
      ongoing: metrics.ongoingReservations,
      completed: metrics.completedReservations,
    },
    catalog: {
      products: metrics.productCount,
      activeProducts: metrics.activeProductCount,
      draftProducts: metrics.draftProductCount,
    },
    customers: {
      total: metrics.customerCount,
      newThisMonth: metrics.newCustomersThisMonth,
    },
  };
}

export async function revenueReport(
  store: AnalyticsStore,
  input: AnalyticsWindowInput,
  now = new Date(),
): Promise<Omit<RevenueReport, "links">> {
  const { window, period } = analyticsWindow(store, input, now);
  const sales = salesStore(store);
  const [payments, reservations, methods, buckets, others] = await Promise.all([
    getSalesPaymentStats(sales, window),
    getPeriodReservationStats(store.id, window),
    getRevenueByPaymentMethod(sales, window),
    getRevenueTimeSeries(sales, window),
    getOtherCurrencyReceipts(sales, window),
  ]);
  return {
    currency: sales.currency,
    window: windowOutput(window, period),
    revenue: amount(payments.periodRevenue),
    revenueGrowth: payments.revenueGrowth,
    paymentCount: payments.periodPaymentCount,
    averagePayment: amount(payments.avgPaymentValue),
    reservations: reservations.reservationCount,
    reservationsGrowth: reservations.growth,
    byPaymentMethod: [...methods]
      .sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method))
      .map((method) => ({
        method: method.method,
        revenue: amount(method.amount),
        paymentCount: Number(method.count),
      })),
    breakdown: buckets.map((bucket) => ({
      start: bucket.start,
      end: bucket.end,
      revenue: amount(bucket.revenue),
      paymentCount: bucket.payments,
    })),
    otherCurrencies: otherCurrenciesOutput(others),
  };
}

export interface RankedProduct {
  id: string;
  slug: string | null;
  status: "draft" | "active" | "archived" | null;
  name: string;
  revenue: string;
  quantity: number;
  reservations: number;
}

export async function productPerformance(
  store: AnalyticsStore,
  input: AnalyticsWindowInput & { limit?: number },
  now = new Date(),
): Promise<Omit<ProductPerformance, "links" | "products"> & { products: RankedProduct[] }> {
  const { window, period } = analyticsWindow(store, input, now);
  const sales = salesStore(store);
  const [ranking, others] = await Promise.all([
    getTopProductsByRevenue(sales, window, input.limit ?? PRODUCT_PERFORMANCE_DEFAULT),
    getOtherCurrencyReceipts(sales, window),
  ]);
  return {
    currency: sales.currency,
    window: windowOutput(window, period),
    products: ranking.products.flatMap((product) =>
      product.productId
        ? [
            {
              id: product.productId,
              slug: product.productSlug,
              status: product.productStatus,
              name: product.productName,
              revenue: product.totalRevenue,
              quantity: Number(product.totalQuantity),
              reservations: Number(product.reservationCount),
            },
          ]
        : [],
    ),
    productCount: ranking.productCount,
    revenue: amount(ranking.totalRevenue),
    catalogRevenue: amount(ranking.catalogRevenue),
    nonCatalogRevenue: amount(ranking.nonCatalogRevenue),
    unallocatedRevenue: amount(ranking.unallocatedRevenue),
    otherCurrencies: otherCurrenciesOutput(others),
  };
}
