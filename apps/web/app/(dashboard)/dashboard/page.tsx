import { auth } from "@/lib/auth";
import { env } from "@/env";
import { getMarketplaceChannelState, getMarketplaceCohortStatus } from "@louez/api/services";
import { storeHasAgentConnection } from "@louez/api/services/agent-grants";
import { db, users } from "@louez/db";
import { getCurrentStore } from "@/lib/store-context";
import { reservations } from "@louez/db";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { getStoreMetrics } from "@louez/api/services/store-metrics";
import { getStoreCalendar, type StoreCalendar } from "@louez/api/services/sales-window";
import { determineStoreState, getTimeOfDay } from "@/lib/dashboard/metrics";
import type { LaunchChecklistView } from "@louez/api/contracts/launch";
import { serverApi } from "@/lib/api/server-api";
import { getMcpEndpoint } from "@/lib/agent-connections/mcp-endpoint";
import { MarketplaceCohortNotice } from "@/components/dashboard/marketplace-cohort-notice";
import {
  parseDismissedNotices,
  type DismissibleNoticeId,
} from "@louez/api/contracts/dismissed-notices";
import { REEENT_SIGNUP_ORIGIN } from "@/lib/utils/signup-origin";
import {
  AgentAssistantNotice,
  DashboardAlert,
  ReeentStripeSetupCard,
  SetupChecklist,
  onlinePaymentsStepOf,
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
  /** The store's time zone, which sets today and the month. */
  timezone: string | null;
  firstName: string;
  /** What the store still lacks, as agents read it (stores.getLaunchChecklist). */
  launchChecklist: LaunchChecklistView;
  /** The store signed up from the reeent consumer marketplace (ADR 010). */
  isFromReeent: boolean;
  hasStripeAccount: boolean;
  dismissedNoticeIds: DismissibleNoticeId[];
}

async function DashboardContent({
  storeId,
  storeSlug,
  timezone,
  firstName,
  launchChecklist,
  isFromReeent,
  hasStripeAccount,
  dismissedNoticeIds,
}: DashboardContentProps) {
  // Stores that want online payments track the Stripe KYC left pending during
  // onboarding (payment mode degrades to request mode until Stripe can charge).
  const onlinePaymentsStep = onlinePaymentsStepOf(launchChecklist);
  const now = new Date();
  const calendar = getStoreCalendar(now, timezone);
  // Fetch all data in parallel
  const [metrics, departures, returns, pending, channelState, cohort, hasAgentConnection] =
    await Promise.all([
      getStoreMetrics(storeId, { timezone, now }),
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

      {/* The offer to let an AI assistant set up and run the store: first of
          the setup notices, under the alert that asks for an action. */}
      {shouldOfferAgentAssistant({ dismissedNoticeIds, hasAgentConnection }) && (
        <AgentAssistantNotice {...getMcpEndpoint()} />
      )}

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
          dismissedNoticeIds={dismissedNoticeIds}
        />
      )}

      {/* Setup Checklist for new stores (floating widget) */}
      {(storeState === "virgin" || storeState === "building") && (
        <SetupChecklist
          initialChecklist={launchChecklist}
          storeSlug={storeSlug}
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
  const userRow = session?.user?.id
    ? await db.query.users.findFirst({
        columns: { dismissedNotices: true },
        where: eq(users.id, session.user.id),
      })
    : undefined;

  const launchChecklist = await (await serverApi()).stores.getLaunchChecklist({});

  return (
    <DashboardContent
      storeId={store.id}
      storeSlug={store.slug}
      timezone={store.settings?.timezone ?? null}
      firstName={firstName}
      launchChecklist={launchChecklist}
      isFromReeent={store.signupOrigin === REEENT_SIGNUP_ORIGIN}
      hasStripeAccount={store.stripeAccountId !== null}
      dismissedNoticeIds={parseDismissedNotices(userRow?.dismissedNotices)}
    />
  );
}
