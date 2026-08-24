import {
  reservationAnalyticsActions,
  type ReservationAnalyticsAction,
} from "@/lib/product-analytics/analytics-events";

export const reservationAnalyticsSources = [
  "home_departure",
  "home_return",
  "home_pending",
  "reservations_list",
  "reservations_timeline",
  "customer_detail",
  "product_detail",
  "assistant_conversation",
  "reservation_created",
  "reservation_edit",
  "inspection",
  "dashboard_home",
  "direct",
  "unknown",
] as const;

export type ReservationAnalyticsSource = (typeof reservationAnalyticsSources)[number];

const reservationAnalyticsSourceSet = new Set<string>(reservationAnalyticsSources);

export const isReservationAnalyticsSource = (
  value: string | null | undefined,
): value is ReservationAnalyticsSource =>
  Boolean(value && reservationAnalyticsSourceSet.has(value));

export const resolveReservationAnalyticsSource = ({
  explicitSource,
  referrerPathname,
}: {
  explicitSource?: string | null;
  referrerPathname?: string | null;
}): ReservationAnalyticsSource => {
  if (isReservationAnalyticsSource(explicitSource)) return explicitSource;
  if (!referrerPathname) return "direct";
  if (referrerPathname === "/dashboard") return "dashboard_home";
  if (referrerPathname.startsWith("/dashboard/reservations")) return "reservations_list";
  if (referrerPathname.startsWith("/dashboard/customers/")) return "customer_detail";
  if (referrerPathname.startsWith("/dashboard/products/")) return "product_detail";
  if (referrerPathname.startsWith("/dashboard/ai-assistant")) return "assistant_conversation";

  return "unknown";
};

/**
 * `returnTo` is the raw dashboard path the detail page should go back to, query
 * string included. It is sanitized on read by `getDashboardReservationBackHref`.
 */
export const getReservationDetailHref = (
  reservationId: string,
  source: ReservationAnalyticsSource,
  returnTo?: string | null,
) => {
  const href = `/dashboard/reservations/${encodeURIComponent(reservationId)}?source=${source}`;
  return returnTo ? `${href}&returnTo=${encodeURIComponent(returnTo)}` : href;
};

export const getReservationStatusAnalyticsAction = (
  status: string,
): ReservationAnalyticsAction | null => {
  const actionByStatus: Record<string, ReservationAnalyticsAction> = {
    confirmed: reservationAnalyticsActions.acceptRequest,
    rejected: reservationAnalyticsActions.rejectRequest,
    ongoing: reservationAnalyticsActions.markPickedUp,
    completed: reservationAnalyticsActions.confirmReturn,
  };

  return actionByStatus[status] ?? null;
};
