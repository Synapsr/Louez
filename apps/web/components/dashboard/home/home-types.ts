/**
 * Client-side mirrors of the types produced by `getStoreMetrics`
 * (`@louez/api/services/store-metrics`) and `@/lib/dashboard/metrics`.
 *
 * Those modules are server-only (they touch the database), so the home
 * widgets — which are client components — redeclare the shapes they render
 * instead of importing them. Keep in sync with `StoreMetrics` / `StoreState`.
 */
export interface StoreMetrics {
  productCount: number;
  activeProductCount: number;
  draftProductCount: number;
  customerCount: number;
  newCustomersThisMonth: number;
  totalReservations: number;
  completedReservations: number;
  pendingReservations: number;
  confirmedReservations: number;
  ongoingReservations: number;
  todaysDepartures: number;
  todaysReturns: number;
  monthlyRevenue: number;
  lastMonthRevenue: number;
  allTimeRevenue: number;
}

export type StoreState = "virgin" | "building" | "starting" | "active" | "established";

/** Reservation shape rendered by the activity lists. */
export interface HomeReservation {
  id: string;
  number: string;
  startDate: Date;
  endDate: Date;
  /**
   * Its scheduled moment has passed and the status says it still has not been
   * handed over (or brought back). Computed on the server: comparing against
   * the browser's clock would disagree with the server-rendered markup.
   */
  isOverdue?: boolean;
  totalAmount: string;
  customer: {
    firstName: string;
    lastName: string;
  };
  items: Array<{
    id: string;
    product: {
      name: string;
    } | null;
  }>;
}
