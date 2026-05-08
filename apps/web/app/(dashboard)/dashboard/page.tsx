import { auth } from '@/lib/auth'
import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations } from '@louez/db'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import {
  getStoreMetrics,
  determineStoreState,
  getTimeOfDay,
} from '@/lib/dashboard/metrics'
import {
  DashboardAlert,
  SetupChecklist,
  AdaptiveHeader,
  AdaptiveStats,
  TodayActivity,
  PendingRequests,
  QuickActions,
  StorefrontWidget,
  GradientMesh,
} from '@/components/dashboard/home'

// =============================================================================
// Data Fetching Functions
// =============================================================================

async function getTodaysDeparturesList(storeId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, 'confirmed'),
      gte(reservations.startDate, today),
      lte(reservations.startDate, tomorrow)
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
  })
}

async function getTodaysReturnsList(storeId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, 'ongoing'),
      gte(reservations.endDate, today),
      lte(reservations.endDate, tomorrow)
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
  })
}

async function getPendingReservationsList(storeId: string) {
  return db.query.reservations.findMany({
    where: and(
      eq(reservations.storeId, storeId),
      eq(reservations.status, 'pending')
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
  })
}

interface DashboardContentProps {
  storeId: string
  storeSlug: string
  firstName: string
}

async function DashboardContent({
  storeId,
  storeSlug,
  firstName,
}: DashboardContentProps) {
  // Fetch all data in parallel
  const [metrics, departures, returns, pending] = await Promise.all([
    getStoreMetrics(storeId),
    getTodaysDeparturesList(storeId),
    getTodaysReturnsList(storeId),
    getPendingReservationsList(storeId),
  ])

  const storeState = determineStoreState(metrics)
  const timeOfDay = getTimeOfDay()

  return (
    <>
      {/* Animated gradient mesh background (fixed to viewport) */}
      <GradientMesh />

      {/* Dashboard content */}
      <div className="relative z-10 space-y-6">
        {/* Adaptive Header */}
        <AdaptiveHeader
          firstName={firstName}
          timeOfDay={timeOfDay}
          storeState={storeState}
          metrics={metrics}
        />

        {/* Priority Alert for pending requests */}
        <DashboardAlert pendingCount={metrics.pendingReservations} />

        {/* Setup Checklist for new stores */}
        {(storeState === 'virgin' || storeState === 'building') && (
          <SetupChecklist metrics={metrics} storeSlug={storeSlug} />
        )}

        {/* Adaptive Stats */}
        <AdaptiveStats metrics={metrics} storeState={storeState} />

        {/* Today's Activity - Only show for active stores */}
        {storeState !== 'virgin' && storeState !== 'building' && (
          <TodayActivity departures={departures} returns={returns} />
        )}

        {/* Pending Requests Table - Only if there are pending requests */}
        {pending.length > 0 && <PendingRequests pending={pending} />}

        {/* Bottom Section: Quick Actions + Storefront */}
        <div className="grid gap-4 md:grid-cols-2">
          <QuickActions storeState={storeState} />
          <StorefrontWidget storeSlug={storeSlug} />
        </div>
      </div>
    </>
  )
}

// =============================================================================
// Main Page Component
// =============================================================================

export default async function DashboardHomePage() {
  const store = await getCurrentStore()
  if (!store) return null

  const session = await auth()
  const firstName = session?.user?.name?.split(' ')[0] || ''

  return (
    <DashboardContent
      storeId={store.id}
      storeSlug={store.slug}
      firstName={firstName}
    />
  )
}
