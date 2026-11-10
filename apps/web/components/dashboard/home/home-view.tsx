import type { FirstDayPath } from "@/lib/dashboard/util.first-day-path";
import type { HomeTipKey } from "@/lib/dashboard/util.home-tip";
import type { PaymentsSetupState } from "@/lib/dashboard/util.payments-setup";
import type { TimeOfDay } from "@/lib/dashboard/util.store-day";
import { cn } from "@louez/utils";

import { HomeHeader } from "./home-header";
import { HomeShopLine } from "./home-shop-line";
import type {
  HomeCalendarDay,
  HomeCohortNotice,
  HomeNextActivity,
  HomeReservation,
  OverdueHomeReservation,
  PendingHomeReservation,
  StoreMetrics,
  StoreState,
} from "./home-types";
import { MonthSummary } from "./month-summary";
import { PendingRequestsCard } from "./pending-requests-card";
import { ReeentOfferBanner } from "./reeent-offer-banner";
import { ReeentPaymentsBanner } from "./reeent-payments-banner";
import { TodayCard } from "./today-card";

export interface HomeViewProps {
  firstName: string;
  timeOfDay: TimeOfDay;
  storeState: StoreState;
  metrics: StoreMetrics;
  storeSlug: string;
  storeName: string;
  /** Requests are the owner's work here; otherwise "Aujourd'hui" takes the width. */
  showRequests: boolean;
  pending: PendingHomeReservation[];
  departures: HomeReservation[];
  returns: HomeReservation[];
  /** The oldest of what previous days left behind, per kind. */
  overdue: OverdueHomeReservation[];
  /** Today and the six days after it, always seven days. */
  week: HomeCalendarDay[];
  /** For a day with nothing planned: the next one that has something. */
  nextActivity: HomeNextActivity | null;
  /** A new store's way to its first request; null once it has activity. */
  firstDay: FirstDayPath | null;
  tip: HomeTipKey | null;
  /** Online payment chosen at onboarding, Stripe not charging yet. */
  paymentsSetup: PaymentsSetupState | null;
  /** The reeent launch offer, when the reeent banner does not carry it. */
  cohortNotice: HomeCohortNotice | null;
  isFromReeent: boolean;
  /** reeent's home, linked from its name in the banners; null without a marketplace. */
  reeentUrl: string | null;
  /** Start of the store's today and "now", both server-side. */
  today: Date;
  now: Date;
}

/**
 * The home, from data to markup and nothing else: the dashboard page loads
 * the data and renders this.
 */
export const HomeView = ({
  firstName,
  timeOfDay,
  storeState,
  metrics,
  storeSlug,
  storeName,
  showRequests,
  pending,
  departures,
  returns,
  overdue,
  week,
  nextActivity,
  firstDay,
  tip,
  paymentsSetup,
  cohortNotice,
  isFromReeent,
  reeentUrl,
  today,
  now,
}: HomeViewProps) => {
  const isNew = storeState === "virgin" || storeState === "building";

  return (
    // The cards sit side by side only when the content area is wide enough —
    // the sidebar, open or folded, changes that more than the screen does.
    // Side by side, they fill the frame's height and scroll inside; stacked,
    // the page scrolls. The frame is the viewport minus its header and
    // paddings; under 34rem of height the page scrolls instead of squeezing.
    <div className="@container/home">
      <div className="flex flex-col gap-4 sm:gap-5 @min-[55rem]/home:h-[max(34rem,calc(100svh-8.5rem))]">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
            <HomeHeader firstName={firstName} timeOfDay={timeOfDay} />
            {!isNew && <MonthSummary metrics={metrics} />}
          </div>
          {/* The first-day path has its own "share" step. */}
          {firstDay === null && <HomeShopLine />}
        </div>

        {/* One banner at most: a reeent store waiting on Stripe is not listed
            there yet, and that banner carries the offer; otherwise the offer. */}
        <div className="empty:hidden">
          {isFromReeent && paymentsSetup ? (
            <ReeentPaymentsBanner state={paymentsSetup} reeentUrl={reeentUrl} />
          ) : (
            cohortNotice && <ReeentOfferBanner notice={cohortNotice} reeentUrl={reeentUrl} />
          )}
        </div>

        <div
          className={cn(
            "grid gap-4 @min-[55rem]/home:min-h-0 @min-[55rem]/home:flex-1 @min-[55rem]/home:grid-rows-[minmax(0,1fr)] lg:gap-5",
            showRequests && "@min-[55rem]/home:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]",
          )}
        >
          {showRequests && (
            <PendingRequestsCard
              pending={pending}
              pendingCount={metrics.pendingReservations}
              firstDay={firstDay}
              tip={tip}
              storeSlug={storeSlug}
              storeName={storeName}
              hasPriorityAction={isFromReeent && paymentsSetup !== null}
              paymentsSetup={paymentsSetup}
              isFromReeent={isFromReeent}
              now={now}
            />
          )}
          <TodayCard
            storeState={storeState}
            metrics={metrics}
            departures={departures}
            returns={returns}
            overdue={overdue}
            week={week}
            nextActivity={nextActivity}
            // Without the requests card, a starting store's tip moves here.
            tip={showRequests ? null : tip}
            today={today}
            now={now}
          />
        </div>
      </div>
    </div>
  );
};
