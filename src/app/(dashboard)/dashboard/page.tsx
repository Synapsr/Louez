import { Suspense } from 'react'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations } from '@/lib/db/schema'
import { eq, and, gte, lte, desc } from 'drizzle-orm'
import {
  getStoreMetrics,
  determineStoreState,
  getTimeOfDay,
  type StoreMetrics,
  type StoreState,
} from '@/lib/dashboard/metrics'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
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

// =============================================================================
// Skeleton Components
// =============================================================================

function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="mt-1 h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[...Array(2)].map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...Array(3)].map((_, j) => (
                <Skeleton key={j} className="h-10 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// =============================================================================
// Server Components for Data Sections
// =============================================================================

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
    <Suspense
      fallback={
        <>
          <GradientMesh />
          <div className="relative z-10 space-y-6">
            {/* Header skeleton */}
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
              <Skeleton className="h-10 w-40" />
            </div>
            <StatsSkeleton />
            <ActivitySkeleton />
          </div>
        </>
      }
    >
      <DashboardContent
        storeId={store.id}
        storeSlug={store.slug}
        firstName={firstName}
      />
    </Suspense>
  )
}
