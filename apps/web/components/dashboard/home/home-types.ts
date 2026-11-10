import type { DismissibleNoticeId } from "@/lib/dashboard/dismissed-notices";
import type { PendingUrgency } from "@/lib/dashboard/util.pending-urgency";

/**
 * Client-side mirrors of the types produced by `@/lib/dashboard/metrics`.
 *
 * That module is server-only (it touches the database), so the home widgets —
 * which are client components — redeclare the shapes they render instead of
 * importing it. Keep in sync with `StoreMetrics` / `StoreState` there.
 */
export interface StoreMetrics {
  productCount: number;
  activeProductCount: number;
  draftProductCount: number;
  customerCount: number;
  newCustomersThisMonth: number;
  totalReservations: number;
  reservationsThisMonth: number;
  completedReservations: number;
  pendingReservations: number;
  confirmedReservations: number;
  ongoingReservations: number;
  todaysDepartures: number;
  todaysReturns: number;
  overdueDepartures: number;
  overdueReturns: number;
  monthlyRevenue: number;
  previousPeriodRevenue: number;
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
    /** How many of the product; one when unknown. */
    quantity?: number;
    product: {
      name: string;
      /** Photo URLs, first one shown in the agenda. */
      images?: string[] | null;
    } | null;
  }>;
}

/** A request waiting for an answer, with how close its start is. */
export interface PendingHomeReservation extends HomeReservation {
  createdAt: Date;
  urgency: PendingUrgency | null;
}

/** A hand-over or a return from a previous day that never happened. */
export interface OverdueHomeReservation extends HomeReservation {
  overdueKind: "departure" | "return";
  /** When it should have happened. */
  dueAt: Date;
}

/** The reeent launch offer, as the home's offer banner reads it. */
export interface HomeCohortNotice {
  /** ISO date once the store joined the launch cohort, null otherwise. */
  lifetimeFeeWaiverAt: string | null;
  cohortRank: number | null;
  /** Seats still open, and the cohort's size. */
  remaining: number;
  total: number;
  /** The store's page on reeent, while it is listed there. */
  listingUrl: string | null;
  dismissedNoticeIds: readonly DismissibleNoticeId[];
}

/** The next day with anything planned, after today. Counts are known inside the week ahead. */
export interface HomeNextActivity {
  date: Date;
  departures?: number;
  returns?: number;
}

/** One day of the home's week calendar, from midnight on the store's clock. */
export interface HomeCalendarDay {
  date: Date;
  departures: number;
  returns: number;
}
