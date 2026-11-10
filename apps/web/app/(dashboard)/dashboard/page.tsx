import { auth } from "@/lib/auth";
import { getCurrentStore } from "@/lib/store-context";
import { getMarketplaceChannelState, getMarketplaceCohortStatus } from "@louez/api/services";
import { db, reservations, users } from "@louez/db";
import type { StoreSettings } from "@louez/types";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { env } from "@/env";
import { parseDismissedNotices, type DismissibleNoticeId } from "@/lib/dashboard/dismissed-notices";
import {
  awaitsOwnerDecisionSql,
  getStoreMetrics,
  determineStoreState,
} from "@/lib/dashboard/metrics";
import type { OnlinePaymentsStep } from "@/lib/dashboard/setup-progress";
import { getFirstDayPath } from "@/lib/dashboard/util.first-day-path";
import { getHomeTip, type HomeTipKey } from "@/lib/dashboard/util.home-tip";
import { OVERDUE_ROWS_MAX } from "@/lib/dashboard/util.overdue-summary";
import { getPaymentsSetupState, shouldShowRequestsCard } from "@/lib/dashboard/util.payments-setup";
import { getPendingUrgency } from "@/lib/dashboard/util.pending-urgency";
import {
  getStoreDay,
  getStoreDayOffset,
  getStoreDayStart,
  type StoreDay,
} from "@/lib/dashboard/util.store-day";
import { getStorePlan } from "@/lib/plan-limits";
import { getIntendedReservationMode, isStripeChargeable } from "@/lib/reservation-mode";
import { REEENT_SIGNUP_ORIGIN } from "@/lib/utils/signup-origin";
import {
  HomeView,
  ReservationsCalendarPrefetch,
  type HomeCalendarDay,
  type HomeCohortNotice,
  type HomeNextActivity,
  type OverdueHomeReservation,
} from "@/components/dashboard/home";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Rows loaded per list. Side by side the cards scroll through all of them;
 * stacked, they show the first few and link to the rest.
 */
const TODAY_LIST_LIMIT = 30;
const PENDING_LIST_LIMIT = 20;
/** The week calendar: today and the six days after it. */
const WEEK_DAY_COUNT = 7;
/** Enough rows to count a week of hand-overs and returns by day. */
const WEEK_ROWS_LIMIT = 2000;

const listRelations = {
  customer: true,
  items: {
    with: {
      product: true,
    },
  },
} as const;

// =============================================================================
// Data Fetching Functions
// =============================================================================

async function getTodaysDeparturesList(storeId: string, day: StoreDay) {
  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, "confirmed"),
      gte(reservations.startDate, day.todayStart),
      lt(reservations.startDate, day.tomorrowStart),
    ),
    with: listRelations,
    orderBy: [asc(reservations.startDate)],
    limit: TODAY_LIST_LIMIT,
  });

  // Still `confirmed` past its pickup time means nobody came for it — or nobody
  // recorded that they did. Either way it is the row that needs the owner, so
  // it is flagged rather than hidden.
  return rows.map((row) => ({ ...row, isOverdue: row.startDate < day.now }));
}

async function getTodaysReturnsList(storeId: string, day: StoreDay) {
  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, "ongoing"),
      gte(reservations.endDate, day.todayStart),
      lt(reservations.endDate, day.tomorrowStart),
    ),
    with: listRelations,
    orderBy: [asc(reservations.endDate)],
    limit: TODAY_LIST_LIMIT,
  });

  // Same reading on the way back: still `ongoing` past its return time means
  // the gear is not back yet.
  return rows.map((row) => ({ ...row, isOverdue: row.endDate < day.now }));
}

/**
 * The oldest of what previous days left behind, per kind: enough to list them
 * when there are few, and to date the oldest when they are summed up.
 */
async function getOverdueList(storeId: string, day: StoreDay): Promise<OverdueHomeReservation[]> {
  const [returns, departures] = await Promise.all([
    db.query.reservations.findMany({
      where: and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, "ongoing"),
        lt(reservations.endDate, day.todayStart),
      ),
      with: listRelations,
      orderBy: [asc(reservations.endDate)],
      limit: OVERDUE_ROWS_MAX,
    }),
    db.query.reservations.findMany({
      where: and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, "confirmed"),
        lt(reservations.startDate, day.todayStart),
      ),
      with: listRelations,
      orderBy: [asc(reservations.startDate)],
      limit: OVERDUE_ROWS_MAX,
    }),
  ]);

  // Gear out of the shop is the real risk: returns lead.
  return [
    ...returns.map((row) => ({ ...row, overdueKind: "return" as const, dueAt: row.endDate })),
    ...departures.map((row) => ({
      ...row,
      overdueKind: "departure" as const,
      dueAt: row.startDate,
    })),
  ];
}

/**
 * Requests waiting on the owner, the ones that start soonest first: their
 * answer is the most urgent. Online checkouts underway are not the owner's.
 */
async function getPendingReservationsList(storeId: string, day: StoreDay) {
  const rows = await db.query.reservations.findMany({
    where: and(eq(reservations.storeId, storeId), awaitsOwnerDecisionSql()),
    with: listRelations,
    orderBy: [asc(reservations.startDate), asc(reservations.createdAt)],
    limit: PENDING_LIST_LIMIT,
  });

  return rows.map((row) => ({ ...row, urgency: getPendingUrgency(day, row.startDate) }));
}

/** Today and the six days after it, counted per day, as the week calendar draws them. */
async function getWeekCalendar(
  storeId: string,
  day: StoreDay,
  today: { departures: number; returns: number },
): Promise<HomeCalendarDay[]> {
  const weekEnd = getStoreDayStart(day, WEEK_DAY_COUNT);
  const [starts, ends] = await Promise.all([
    db
      .select({ at: reservations.startDate })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          eq(reservations.status, "confirmed"),
          gte(reservations.startDate, day.tomorrowStart),
          lt(reservations.startDate, weekEnd),
        ),
      )
      .limit(WEEK_ROWS_LIMIT),
    db
      .select({ at: reservations.endDate })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          inArray(reservations.status, ["confirmed", "ongoing"]),
          gte(reservations.endDate, day.tomorrowStart),
          lt(reservations.endDate, weekEnd),
        ),
      )
      .limit(WEEK_ROWS_LIMIT),
  ]);

  // Today's counts come from the agenda's own figures, so the two always agree.
  const week = emptyWeek(day);
  week[0] = { ...week[0], ...today };
  for (const row of starts) {
    const target = week[getStoreDayOffset(day, row.at)];
    if (target) target.departures += 1;
  }
  for (const row of ends) {
    const target = week[getStoreDayOffset(day, row.at)];
    if (target) target.returns += 1;
  }
  return week;
}

const emptyWeek = (day: StoreDay): HomeCalendarDay[] =>
  Array.from({ length: WEEK_DAY_COUNT }, (_, offset) => ({
    date: getStoreDayStart(day, offset),
    departures: 0,
    returns: 0,
  }));

/**
 * For a day with nothing planned: the next day that has something — within
 * the week calendar, or the first one after it.
 */
async function getNextActivity(
  storeId: string,
  day: StoreDay,
  week: HomeCalendarDay[],
): Promise<HomeNextActivity | null> {
  const inWeek = week.slice(1).find((entry) => entry.departures + entry.returns > 0);
  if (inWeek) return inWeek;

  const weekEnd = getStoreDayStart(day, WEEK_DAY_COUNT);
  const [nextStart, nextEnd] = await Promise.all([
    db
      .select({ at: reservations.startDate })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          eq(reservations.status, "confirmed"),
          gte(reservations.startDate, weekEnd),
        ),
      )
      .orderBy(asc(reservations.startDate))
      .limit(1),
    db
      .select({ at: reservations.endDate })
      .from(reservations)
      .where(
        and(
          eq(reservations.storeId, storeId),
          inArray(reservations.status, ["confirmed", "ongoing"]),
          gte(reservations.endDate, weekEnd),
        ),
      )
      .orderBy(asc(reservations.endDate))
      .limit(1),
  ]);
  const candidates = [nextStart[0]?.at, nextEnd[0]?.at].filter((at): at is Date => Boolean(at));
  if (candidates.length === 0) return null;
  const first = new Date(Math.min(...candidates.map((at) => at.getTime())));
  return { date: getStoreDayStart(day, getStoreDayOffset(day, first)) };
}

/**
 * The launch-cohort line: the earned waiver, or the seats still open. A reeent
 * store that has not earned it yet does not get the seats pitch: it already
 * signed up, and its banner carries the offer while it waits on Stripe.
 */
async function getCohortNotice(
  storeId: string,
  isFromReeent: boolean,
  dismissedNoticeIds: DismissibleNoticeId[],
): Promise<HomeCohortNotice | null> {
  // The channel lookup must never take the home down.
  try {
    const [channelState, cohort] = await Promise.all([
      getMarketplaceChannelState({ storeId }),
      getMarketplaceCohortStatus(env.REEENT_LAUNCH_COHORT_SIZE),
    ]);
    const lifetimeFeeWaiverAt = channelState.channel?.lifetimeFeeWaiverAt ?? null;
    if (lifetimeFeeWaiverAt === null && isFromReeent) return null;
    // Same public listing as the sidebar's "Voir ma page reeent" (dashboard layout).
    const listingUrl =
      env.MARKETPLACE_URL && channelState.channel?.status === "published"
        ? new URL(`/fr/go/louez/${storeId}`, env.MARKETPLACE_URL).toString()
        : null;
    return {
      lifetimeFeeWaiverAt,
      cohortRank: channelState.channel?.cohortRank ?? null,
      remaining: cohort.remaining,
      total: cohort.total,
      listingUrl,
      dismissedNoticeIds,
    };
  } catch {
    return null;
  }
}

/** The one "next step" of the requests card, among the tips not closed. */
async function getRequestsTip({
  storeId,
  dismissed,
  paysOnSite,
  hasFirstDayPath,
  isStartingAndUpToDate,
  reviewBoosterEnabled,
}: {
  storeId: string;
  dismissed: DismissibleNoticeId[];
  paysOnSite: boolean;
  hasFirstDayPath: boolean;
  isStartingAndUpToDate: boolean;
  reviewBoosterEnabled: boolean;
}): Promise<HomeTipKey | null> {
  // The plan only matters to the review tip, which only a starting store gets.
  const plan = isStartingAndUpToDate ? await getStorePlan(storeId) : null;
  return getHomeTip({
    dismissed,
    paysOnSite,
    hasFirstDayPath,
    isStartingAndUpToDate,
    reviewBoosterAvailable: plan?.features.reviewBooster ?? false,
    reviewBoosterEnabled,
  });
}

interface DashboardContentProps {
  storeId: string;
  storeSlug: string;
  storeName: string;
  firstName: string;
  userId: string | undefined;
  day: StoreDay;
  isFromReeent: boolean;
  onlinePaymentsStep: OnlinePaymentsStep;
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean | null;
  reviewBoosterEnabled: boolean;
}

async function DashboardContent({
  storeId,
  storeSlug,
  storeName,
  firstName,
  userId,
  day,
  isFromReeent,
  onlinePaymentsStep,
  stripeAccountId,
  stripeOnboardingComplete,
  reviewBoosterEnabled,
}: DashboardContentProps) {
  const [metrics, departures, returns, overdue, pending, user] = await Promise.all([
    getStoreMetrics(storeId, day),
    getTodaysDeparturesList(storeId, day),
    getTodaysReturnsList(storeId, day),
    getOverdueList(storeId, day),
    getPendingReservationsList(storeId, day),
    userId
      ? db.query.users.findFirst({
          columns: { dismissedNotices: true },
          where: eq(users.id, userId),
        })
      : null,
  ]);
  const dismissed = parseDismissedNotices(user?.dismissedNotices);

  const storeState = determineStoreState(metrics);
  const isNew = storeState === "virgin" || storeState === "building";
  const paymentsSetup = getPaymentsSetupState({
    onlinePaymentsStep,
    stripeAccountId,
    stripeOnboardingComplete,
  });
  // Until the first request, the requests card walks the store to it.
  const firstDay =
    isNew && pending.length === 0
      ? getFirstDayPath({
          activeProductCount: metrics.activeProductCount,
          onlinePaymentsStep,
          paymentsSetup,
          isFromReeent,
        })
      : null;
  const showRequests = shouldShowRequestsCard({
    paysOnline: onlinePaymentsStep === "done",
    actionablePendingCount: metrics.pendingReservations,
    hasFirstDayPath: firstDay !== null,
  });
  const todayCounts = { departures: metrics.todaysDepartures, returns: metrics.todaysReturns };

  const [week, tip, cohortNotice] = await Promise.all([
    isNew ? emptyWeek(day) : getWeekCalendar(storeId, day, todayCounts),
    getRequestsTip({
      storeId,
      dismissed,
      paysOnSite: onlinePaymentsStep === "hidden",
      hasFirstDayPath: firstDay !== null,
      isStartingAndUpToDate: storeState === "starting" && pending.length === 0,
      reviewBoosterEnabled,
    }),
    // A reeent store waiting on Stripe has its own banner, which carries the offer.
    isFromReeent && paymentsSetup !== null
      ? null
      : getCohortNotice(storeId, isFromReeent, dismissed),
  ]);
  // Today's empty state names it, and so does any quiet day picked in the week.
  const nextActivity = isNew ? null : await getNextActivity(storeId, day, week);

  return (
    <>
      {!isNew && <ReservationsCalendarPrefetch />}
      <HomeView
        firstName={firstName}
        timeOfDay={day.timeOfDay}
        storeState={storeState}
        metrics={metrics}
        storeSlug={storeSlug}
        storeName={storeName}
        showRequests={showRequests}
        pending={pending}
        departures={departures}
        returns={returns}
        overdue={overdue}
        week={week}
        nextActivity={nextActivity}
        firstDay={firstDay}
        tip={tip}
        paymentsSetup={paymentsSetup}
        cohortNotice={cohortNotice}
        isFromReeent={isFromReeent}
        reeentUrl={env.MARKETPLACE_URL ?? null}
        today={day.todayStart}
        now={day.now}
      />
    </>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default async function DashboardHomePage() {
  const store = await getCurrentStore();
  if (!store) return null;

  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] || "";
  const settings: StoreSettings | null = store.settings;

  // Same reading as the sidebar's setup list (dashboard layout).
  const onlinePaymentsStep: OnlinePaymentsStep =
    getIntendedReservationMode(store) === "payment"
      ? isStripeChargeable(store)
        ? "done"
        : "todo"
      : "hidden";

  return (
    <DashboardContent
      storeId={store.id}
      storeSlug={store.slug}
      storeName={store.name}
      firstName={firstName}
      userId={session?.user?.id}
      day={getStoreDay(new Date(), settings?.timezone)}
      isFromReeent={store.signupOrigin === REEENT_SIGNUP_ORIGIN}
      onlinePaymentsStep={onlinePaymentsStep}
      stripeAccountId={store.stripeAccountId}
      stripeOnboardingComplete={store.stripeOnboardingComplete}
      reviewBoosterEnabled={store.reviewBoosterSettings?.enabled ?? false}
    />
  );
}
