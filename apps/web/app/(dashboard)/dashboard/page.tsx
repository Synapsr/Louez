import { auth } from "@/lib/auth";
import { getCurrentStore } from "@/lib/store-context";
import { db, reservations } from "@louez/db";
import { and, count, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { getStoreMetrics, determineStoreState, getTimeOfDay } from "@/lib/dashboard/metrics";
import { getIntendedReservationMode, isStripeChargeable } from "@/lib/reservation-mode";
import { REEENT_SIGNUP_ORIGIN } from "@/lib/utils/signup-origin";
import {
  HomeHeader,
  MonthSummary,
  PendingRequestsCard,
  ReeentStripeSetupCard,
  ReservationsCalendarPrefetch,
  TodayCard,
  type UpcomingDay,
} from "@/components/dashboard/home";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Enough for a busy day on the timeline; the full list is one click away. */
const TODAY_LIST_LIMIT = 8;
const UPCOMING_DAY_COUNT = 3;

// =============================================================================
// Data Fetching Functions
// =============================================================================

const startOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

async function getTodaysDeparturesList(storeId: string) {
  const now = new Date();
  const today = startOfToday();
  const tomorrow = addDays(today, 1);

  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, "confirmed"),
      gte(reservations.startDate, today),
      lte(reservations.startDate, tomorrow),
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: [reservations.startDate],
    limit: TODAY_LIST_LIMIT,
  });

  // Still `confirmed` past its pickup time means nobody came for it — or nobody
  // recorded that they did. Either way it is the row that needs the owner, so
  // it is flagged rather than hidden. Ascending order already floats these up.
  return rows.map((row) => ({ ...row, isOverdue: row.startDate < now }));
}

async function getTodaysReturnsList(storeId: string) {
  const now = new Date();
  const today = startOfToday();
  const tomorrow = addDays(today, 1);

  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, "ongoing"),
      gte(reservations.endDate, today),
      lte(reservations.endDate, tomorrow),
    ),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: [reservations.endDate],
    limit: TODAY_LIST_LIMIT,
  });

  // Same reading on the way back: still `ongoing` past its return time means
  // the gear is not back yet.
  return rows.map((row) => ({ ...row, isOverdue: row.endDate < now }));
}

async function getPendingReservationsList(storeId: string) {
  return db.query.reservations.findMany({
    where: and(eq(reservations.storeId, storeId), eq(reservations.status, "pending")),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: [desc(reservations.createdAt)],
    limit: 5,
  });
}

/** Hand-overs and returns planned on each of the next days, as counts only. */
async function getUpcomingDays(storeId: string): Promise<UpcomingDay[]> {
  const today = startOfToday();
  const days = Array.from({ length: UPCOMING_DAY_COUNT }, (_, index) => addDays(today, index + 1));

  return Promise.all(
    days.map(async (day) => {
      const nextDay = addDays(day, 1);
      const [departureRows, returnRows] = await Promise.all([
        db
          .select({ value: count() })
          .from(reservations)
          .where(
            and(
              eq(reservations.storeId, storeId),
              eq(reservations.status, "confirmed"),
              gte(reservations.startDate, day),
              lt(reservations.startDate, nextDay),
            ),
          ),
        db
          .select({ value: count() })
          .from(reservations)
          .where(
            and(
              eq(reservations.storeId, storeId),
              inArray(reservations.status, ["confirmed", "ongoing"]),
              gte(reservations.endDate, day),
              lt(reservations.endDate, nextDay),
            ),
          ),
      ]);
      return {
        date: day,
        departures: departureRows[0]?.value ?? 0,
        returns: returnRows[0]?.value ?? 0,
      };
    }),
  );
}

interface DashboardContentProps {
  storeId: string;
  storeSlug: string;
  storeName: string;
  firstName: string;
  /** A reeent store stays unpublished there until Stripe can charge. */
  showReeentBanner: boolean;
  hasStripeAccount: boolean;
}

async function DashboardContent({
  storeId,
  storeSlug,
  storeName,
  firstName,
  showReeentBanner,
  hasStripeAccount,
}: DashboardContentProps) {
  const [metrics, departures, returns, pending] = await Promise.all([
    getStoreMetrics(storeId),
    getTodaysDeparturesList(storeId),
    getTodaysReturnsList(storeId),
    getPendingReservationsList(storeId),
  ]);

  const storeState = determineStoreState(metrics);
  const isNew = storeState === "virgin" || storeState === "building";
  // A quiet day still tells what comes next.
  const upcoming =
    !isNew && departures.length === 0 && returns.length === 0 ? await getUpcomingDays(storeId) : null;

  return (
    // Fills the content frame's height (viewport minus its header and paddings)
    // so the two cards below can stretch to the bottom.
    <div className="flex flex-col gap-5 sm:gap-6 lg:min-h-[calc(100svh-8.5rem)]">
      {!isNew && <ReservationsCalendarPrefetch />}

      <div className="space-y-4">
        <HomeHeader
          firstName={firstName}
          timeOfDay={getTimeOfDay()}
          storeState={storeState}
          metrics={metrics}
        />
        {!isNew && <MonthSummary metrics={metrics} />}
      </div>

      {showReeentBanner && <ReeentStripeSetupCard hasStripeAccount={hasStripeAccount} />}

      {/* The two things a renter checks every day, side by side and full height. */}
      <div className="grid flex-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-5">
        <PendingRequestsCard
          storeState={storeState}
          pending={pending}
          pendingCount={metrics.pendingReservations}
          storeSlug={storeSlug}
          storeName={storeName}
          hasPriorityAction={showReeentBanner}
        />
        <TodayCard
          storeState={storeState}
          metrics={metrics}
          departures={departures}
          returns={returns}
          upcoming={upcoming}
          today={startOfToday()}
        />
      </div>
    </div>
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

  const onlinePaymentsTodo =
    getIntendedReservationMode(store) === "payment" && !isStripeChargeable(store);

  return (
    <DashboardContent
      storeId={store.id}
      storeSlug={store.slug}
      storeName={store.name}
      firstName={firstName}
      showReeentBanner={store.signupOrigin === REEENT_SIGNUP_ORIGIN && onlinePaymentsTodo}
      hasStripeAccount={store.stripeAccountId !== null}
    />
  );
}
