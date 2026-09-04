import { auth } from "@/lib/auth";
import { env } from "@/env";
import { getMarketplaceChannelState, getMarketplaceCohortStatus } from "@louez/api/services";
import { db } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { reservations } from "@louez/db";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { getStoreMetrics, determineStoreState, getTimeOfDay } from "@/lib/dashboard/metrics";
import { getIntendedReservationMode, isStripeChargeable } from "@/lib/reservation-mode";
import type { OnlinePaymentsStep } from "@/components/dashboard/home";
import { MarketplaceCohortNotice } from "@/components/dashboard/marketplace-cohort-notice";
import { REEENT_SIGNUP_ORIGIN } from "@/lib/utils/signup-origin";
import {
  DashboardAlert,
  ReeentStripeSetupCard,
  SetupChecklist,
  AdaptiveHeader,
  AdaptiveStats,
  TodayActivity,
  PendingRequests,
  QuickActions,
  ReservationsCalendarPrefetch,
  StorefrontWidget,
} from "@/components/dashboard/home";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

// =============================================================================
// Data Fetching Functions
// =============================================================================

async function getTodaysDeparturesList(storeId: string) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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
    limit: 5,
  });

  // Still `confirmed` past its pickup time means nobody came for it — or nobody
  // recorded that they did. Either way it is the row that needs the owner, so
  // it is flagged rather than hidden. Ascending order already floats these up.
  return rows.map((row) => ({ ...row, isOverdue: row.startDate < now }));
}

async function getTodaysReturnsList(storeId: string) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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
    limit: 5,
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

interface DashboardContentProps {
  storeId: string;
  storeSlug: string;
  firstName: string;
  onlinePaymentsStep: OnlinePaymentsStep;
  /** The store signed up from the reeent consumer marketplace (ADR 010). */
  isFromReeent: boolean;
  hasStripeAccount: boolean;
}

async function DashboardContent({
  storeId,
  storeSlug,
  firstName,
  onlinePaymentsStep,
  isFromReeent,
  hasStripeAccount,
}: DashboardContentProps) {
  // Fetch all data in parallel
  const [metrics, departures, returns, pending, channelState, cohort] = await Promise.all([
    getStoreMetrics(storeId),
    getTodaysDeparturesList(storeId),
    getTodaysReturnsList(storeId),
    getPendingReservationsList(storeId),
    getMarketplaceChannelState({ storeId }),
    getMarketplaceCohortStatus(env.REEENT_LAUNCH_COHORT_SIZE),
  ]);

  const storeState = determineStoreState(metrics);
  const timeOfDay = getTimeOfDay();
  const lifetimeFeeWaiverAt = channelState.channel?.lifetimeFeeWaiverAt ?? null;

  return (
    <div className="space-y-4 sm:space-y-6">
      {storeState !== "virgin" && storeState !== "building" && <ReservationsCalendarPrefetch />}

      {/* Adaptive Header */}
      <AdaptiveHeader
        firstName={firstName}
        timeOfDay={timeOfDay}
        storeState={storeState}
        metrics={metrics}
      />

      {/* Priority Alert for pending requests */}
      <DashboardAlert pendingCount={metrics.pendingReservations} />

      {/* Stores from reeent are not published there until Stripe can charge. */}
      {isFromReeent && onlinePaymentsStep === "todo" && (
        <ReeentStripeSetupCard hasStripeAccount={hasStripeAccount} />
      )}

      {/* Launch-cohort status: the earned waiver, or the seats still open. The
          seats pitch is dropped for a reeent store that has not earned the
          waiver yet — it already signed up, and the card above carries the
          offer. The earned badge still shows everywhere. */}
      {(lifetimeFeeWaiverAt !== null || !isFromReeent) && (
        <MarketplaceCohortNotice
          lifetimeFeeWaiverAt={lifetimeFeeWaiverAt}
          cohortRank={channelState.channel?.cohortRank ?? null}
          remaining={cohort.remaining}
        />
      )}

      {/* Setup Checklist for new stores (floating widget) */}
      {(storeState === "virgin" || storeState === "building") && (
        <SetupChecklist
          metrics={metrics}
          storeSlug={storeSlug}
          onlinePaymentsStep={onlinePaymentsStep}
          onlinePaymentsContext={isFromReeent ? "reeent" : "default"}
        />
      )}

      {/* Adaptive Stats */}
      <AdaptiveStats metrics={metrics} storeState={storeState} />

      {/* Today's Activity - Only show for active stores */}
      {storeState !== "virgin" && storeState !== "building" && (
        <TodayActivity departures={departures} returns={returns} />
      )}

      {/* Pending Requests Table - Only if there are pending requests */}
      {pending.length > 0 && <PendingRequests pending={pending} />}

      {/* Bottom Section: Quick Actions + Storefront */}
      <div className="grid gap-4 lg:grid-cols-2">
        <QuickActions storeState={storeState} />
        <StorefrontWidget storeSlug={storeSlug} />
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

  // Stores that want online payments get a checklist step tracking the
  // Stripe KYC left pending during onboarding (payment mode silently degrades
  // to request mode until Stripe is chargeable — see lib/reservation-mode.ts).
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
      firstName={firstName}
      onlinePaymentsStep={onlinePaymentsStep}
      isFromReeent={store.signupOrigin === REEENT_SIGNUP_ORIGIN}
      hasStripeAccount={store.stripeAccountId !== null}
    />
  );
}
