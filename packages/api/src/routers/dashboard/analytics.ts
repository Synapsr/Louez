import {
  getDashboardStatsInput,
  getDashboardStatsOutput,
  getProductPerformanceInput,
  getProductPerformanceOutput,
  getRevenueReportInput,
  getRevenueReportOutput,
  type AnalyticsPeriod,
} from "../../contracts/analytics";
import { dashboardPageLinks, productLinks } from "../../platform/links";
import { storeProcedure } from "../../platform/procedures";
import { dashboardStats, productPerformance, revenueReport } from "../../services/analytics";

/**
 * The store's figures, on every transport: the dashboard (RPC),
 * `/api/v1/analytics` (OpenAPI) and three MCP tools in the daily bundle. They
 * run the queries of the dashboard's home and sales pages
 * (services/sales-analytics.ts), live, so an agent reads what the dashboard
 * shows. The tool names predate the `domain_action` rule and stay as they are.
 */

const REVENUE =
  "Revenue is the rental payments received: completed rental payments of every method (card, cash, transfer…), counted on the day they were cashed in; deposits and refunds are left out.";

const WINDOW =
  "Takes a rolling `period` of the dashboard's filter (7d, 30d, 90d, 6m or 12m; default 30d) or a custom range of whole days, startDate to endDate included, 731 days at most. Days start at midnight in the store's time zone, and a window ends at the time of the call at the latest, so today counts up to now.";

const AMOUNTS = "Amounts are decimal strings in the store's `currency`.";

const salesPage = (period: AnalyticsPeriod | null) =>
  period ? (`/dashboard/analytics/sales?period=${period}` as const) : "/dashboard/analytics/sales";

const getDashboardStats = storeProcedure
  .meta({
    capability: "analytics.getDashboardStats",
    scope: { domain: "analytics", level: "read" },
    mcp: {
      name: "get_dashboard_stats",
      title: "Get Dashboard Stats",
      description: `Get the figures of the store's dashboard home, live: today's revenue, departures (confirmed reservations starting today) and returns (ongoing reservations due back today); the revenue since the first of the month, over the previous month and since the store opened; the reservations by status; the products and the customers. ${REVENUE} Today and the month follow the store's time zone, given as \`timezone\`. ${AMOUNTS} Storefront visitors are not included. Its \`links\` hold the dashboard home.`,
      bundle: "daily",
    },
  })
  .route({ method: "GET", path: "/analytics/dashboard" })
  .input(getDashboardStatsInput)
  .output(getDashboardStatsOutput)
  .handler(async ({ context }) => ({
    ...(await dashboardStats(context.store)),
    links: dashboardPageLinks(context.ports.urls, context.store, "/dashboard"),
  }));

const getRevenueReport = storeProcedure
  .meta({
    capability: "analytics.getRevenueReport",
    scope: { domain: "analytics", level: "read" },
    mcp: {
      name: "get_revenue_report",
      title: "Get Revenue Report",
      description: `Get the store's revenue over a period, as the dashboard's sales page shows it: the total, its change against the window of the same length right before, the number of payments and their average, the split by payment method, and the revenue per day (per month past 92 days). ${REVENUE} Also counts the reservations that start over the window (pending, confirmed, ongoing or completed). ${WINDOW} ${AMOUNTS} Its \`links\` hold the sales page.`,
      bundle: "daily",
    },
  })
  .route({ method: "GET", path: "/analytics/revenue" })
  .input(getRevenueReportInput)
  .output(getRevenueReportOutput)
  .handler(async ({ context, input }) => {
    const report = await revenueReport(context.store, input);
    return {
      ...report,
      links: dashboardPageLinks(context.ports.urls, context.store, salesPage(report.window.period)),
    };
  });

const getProductPerformance = storeProcedure
  .meta({
    capability: "analytics.getProductPerformance",
    scope: { domain: "analytics", level: "read" },
    mcp: {
      name: "get_product_performance",
      title: "Get Product Performance",
      description: `Rank the store's products by revenue over a period, as the top products table of the dashboard's sales page does: each reservation's payments received over the window are split across its items in proportion to their price, and each product gets its share, with the units booked and the reservations behind it. ${REVENUE} Returns the \`limit\` best (10 by default, 50 at most), how many products brought revenue, and the window's revenue with the parts that went to the products, to items outside the catalog and to reservations without priced items. ${WINDOW} ${AMOUNTS} Storefront views are not included. Each product has \`links\`, the URLs to give the user.`,
      bundle: "daily",
    },
  })
  .route({ method: "GET", path: "/analytics/products" })
  .input(getProductPerformanceInput)
  .output(getProductPerformanceOutput)
  .handler(async ({ context, input }) => {
    const { urls } = context.ports;
    const ranking = await productPerformance(context.store, input);
    return {
      ...ranking,
      products: ranking.products.map(({ slug, status, ...product }) => ({
        ...product,
        links: productLinks(urls, context.store, { id: product.id, slug, status }),
      })),
      links: dashboardPageLinks(urls, context.store, salesPage(ranking.window.period)),
    };
  });

export const dashboardAnalyticsRouter = {
  getDashboardStats,
  getRevenueReport,
  getProductPerformance,
};
