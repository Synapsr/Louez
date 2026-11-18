import { auth } from "@/lib/auth";
import { env } from "@/env";
import { getMarketplaceChannelState, getMarketplaceCohortStatus } from "@louez/api/services";
import { storeHasAgentConnection } from "@louez/api/services/agent-grants";
import { db, users } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { excludeTestReservations, reservations } from "@louez/db";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { salesStore } from "@louez/api/services/sales-analytics";
import { getStoreMetrics } from "@louez/api/services/store-metrics";
import { getStoreCalendar, type StoreCalendar } from "@louez/api/services/sales-window";
import { determineStoreState, getTimeOfDay } from "@/lib/dashboard/metrics";
import type { LaunchChecklistView } from "@louez/api/contracts/launch";
import type { GetTestReservationOutput } from "@louez/api/contracts/test-reservations";
import type { VisibilityView } from "@louez/api/contracts/visibility";
import {
  nextVisibilityStep,
  shouldOfferVisibilityGuide,
} from "@/components/dashboard/visibility/util.visibility-steps";
import { serverApi } from "@/lib/api/server-api";
import { getMcpEndpoint } from "@/lib/agent-connections/mcp-endpoint";
import { isBillingEnabled } from "@/lib/billing/mode";
import {
  parseDismissedNotices,
  type DismissibleNoticeId,
} from "@louez/api/contracts/dismissed-notices";
import { REEENT_SIGNUP_ORIGIN } from "@/lib/utils/signup-origin";
import {
  DashboardAlert,
  HomeNextStep,
  SetupChecklist,
  TEST_RESERVATION_NOTICE_ID,
  cohortNoticeOf,
  onlinePaymentsStepOf,
  pickHomeNextStep,
  AdaptiveHeader,
  AdaptiveStats,
  TodayActivity,
  PendingRequests,
  QuickActions,
  ReservationsCalendarPrefetch,
  StorefrontWidget,
  shouldOfferAgentAssistant,
} from "@/components/dashboard/home";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

// =============================================================================
// Data Fetching Functions
// =============================================================================

/** Today is the store's, as the home's counters read it (getStoreMetrics). */
async function getTodaysDeparturesList(storeId: string, now: Date, calendar: StoreCalendar) {
  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, "confirmed"),
      // The test reservation has its own card (test-reservations).
      excludeTestReservations(),
      gte(reservations.startDate, calendar.todayStart),
      lt(reservations.startDate, calendar.tomorrowStart),
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

async function getTodaysReturnsList(storeId: string, now: Date, calendar: StoreCalendar) {
  const rows = await db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, "ongoing"),
      // The test reservation has its own card (test-reservations).
      excludeTestReservations(),
      gte(reservations.endDate, calendar.todayStart),
      lt(reservations.endDate, calendar.tomorrowStart),
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
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, "pending"),
      // The test reservation has its own card (test-reservations).
      excludeTestReservations(),
    ),
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
  storeName: string;
  storeSlug: string;
  /** The store's time zone, which sets today and the month. */
  timezone: string | null;
  /** The store's current currency, the one its revenue is counted in. */
  currency: string;
  firstName: string;
  /** What the store still lacks, as agents read it (stores.getLaunchChecklist). */
  launchChecklist: LaunchChecklistView;
  /** The store signed up from the reeent consumer marketplace (ADR 010). */
  isFromReeent: boolean;
  hasStripeAccount: boolean;
  dismissedNoticeIds: DismissibleNoticeId[];
  /** The test reservation's card, or null when the store does not need it. */
  testReservation: GetTestReservationOutput | null;
  /** The "Se faire connaître" guide's card, or null when it is not offered. */
  visibility: VisibilityView | null;
  /** The user owns the store, so may be offered a plan (the billing pages are the owner's). */
  isStoreOwner: boolean;
}

async function DashboardContent({
  storeId,
  storeName,
  storeSlug,
  timezone,
  currency,
  firstName,
  launchChecklist,
  isFromReeent,
  hasStripeAccount,
  dismissedNoticeIds,
  testReservation,
  visibility,
  isStoreOwner,
}: DashboardContentProps) {
  // Stores that want online payments track the Stripe KYC left pending during
  // onboarding (payment mode degrades to request mode until Stripe can charge).
  const onlinePaymentsStep = onlinePaymentsStepOf(launchChecklist);
  const now = new Date();
  const calendar = getStoreCalendar(now, timezone);
  // Fetch all data in parallel
  const [metrics, departures, returns, pending, channelState, cohort, hasAgentConnection] =
    await Promise.all([
      getStoreMetrics({ id: storeId, currency }, { timezone, now }),
      getTodaysDeparturesList(storeId, now, calendar),
      getTodaysReturnsList(storeId, now, calendar),
      getPendingReservationsList(storeId),
      getMarketplaceChannelState({ storeId }),
      getMarketplaceCohortStatus(env.REEENT_LAUNCH_COHORT_SIZE),
      storeHasAgentConnection(storeId),
    ]);

  const storeState = determineStoreState(metrics);
  const timeOfDay = getTimeOfDay();
  const lifetimeFeeWaiverAt = channelState.channel?.lifetimeFeeWaiverAt ?? null;
  const billingEnabled = isBillingEnabled();
  const assistant = shouldOfferAgentAssistant({ dismissedNoticeIds, hasAgentConnection })
    ? getMcpEndpoint()
    : null;
  const cohortNotice = cohortNoticeOf({
    billingEnabled,
    isFromReeent,
    hasLifetimeFeeWaiver: lifetimeFeeWaiverAt !== null,
    remainingSeats: cohort.remaining,
    dismissedNoticeIds,
  });
  // One guidance card at a time (docs/product/accueil-prochaine-etape.md).
  const nextStep = pickHomeNextStep({
    dismissedNoticeIds,
    reeentAwaitsStripe: isFromReeent && onlinePaymentsStep === "todo",
    hasActiveProduct: launchChecklist.catalog.hasActiveProduct,
    hasRealReservation: launchChecklist.milestones?.firstReservation ?? false,
    testReservationStatus: testReservation?.reservation?.status ?? null,
    canOfferPlan: isStoreOwner && billingEnabled,
    visibilityHasNextStep: visibility !== null && nextVisibilityStep(visibility.steps) !== null,
    agentAssistantOffered: assistant !== null,
    cohortNotice,
  });

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

      {/* Priority Alert for pending requests: today's work, not guidance. */}
      <DashboardAlert pendingCount={metrics.pendingReservations} />

      <HomeNextStep
        choice={nextStep}
        storeId={storeId}
        hasStripeAccount={hasStripeAccount}
        assistant={assistant}
        testReservation={testReservation}
        visibility={visibility}
        launchOfferSeats={cohortNotice === "seats" ? cohort.remaining : null}
        cohort={{
          lifetimeFeeWaiverAt,
          cohortRank: channelState.channel?.cohortRank ?? null,
          remaining: cohort.remaining,
        }}
        dismissedNoticeIds={dismissedNoticeIds}
      />

      {/* Setup Checklist for new stores (floating widget) */}
      {(storeState === "virgin" || storeState === "building") && (
        <SetupChecklist
          initialChecklist={launchChecklist}
          storeSlug={storeSlug}
          onlinePaymentsContext={isFromReeent ? "reeent" : "default"}
          assistant={assistant}
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
        <StorefrontWidget storeId={storeId} storeName={storeName} storeSlug={storeSlug} />
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
  const userRow = session?.user?.id
    ? await db.query.users.findFirst({
        columns: { dismissedNotices: true },
        where: eq(users.id, session.user.id),
      })
    : undefined;

  const api = await serverApi();
  const launchChecklist = await api.stores.getLaunchChecklist({});
  const dismissedNoticeIds = parseDismissedNotices(userRow?.dismissedNotices);
  const [testReservation, visibility] = await Promise.all([
    // The test reservation's card: a product to book, no real reservation yet, not closed.
    launchChecklist.catalog.hasActiveProduct &&
    !launchChecklist.milestones?.firstReservation &&
    !dismissedNoticeIds.includes(TEST_RESERVATION_NOTICE_ID)
      ? api.testReservations.get({})
      : null,
    shouldOfferVisibilityGuide({
      online: launchChecklist.online,
      hasActiveProduct: launchChecklist.catalog.hasActiveProduct,
      dismissedNoticeIds,
    })
      ? api.visibility.get({})
      : null,
  ]);

  return (
    <DashboardContent
      storeId={store.id}
      storeName={store.name}
      storeSlug={store.slug}
      timezone={store.settings?.timezone ?? null}
      currency={salesStore(store).currency}
      firstName={firstName}
      launchChecklist={launchChecklist}
      isFromReeent={store.signupOrigin === REEENT_SIGNUP_ORIGIN}
      hasStripeAccount={store.stripeAccountId !== null}
      dismissedNoticeIds={dismissedNoticeIds}
      testReservation={testReservation}
      visibility={visibility}
      isStoreOwner={store.role === "owner"}
    />
  );
}
