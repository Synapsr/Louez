import { Suspense } from 'react'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations } from '@/lib/db/schema'
import { eq, desc, and, count, gte, lte } from 'drizzle-orm'

import { getStoreLimits, getStorePlan } from '@/lib/plan-limits'
import { Skeleton } from '@/components/ui/skeleton'
import { ReservationsPageContent } from './reservations-page-content'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

async function getReservations(
  storeId: string,
  searchParams: { status?: string; period?: string }
) {
  const conditions = [eq(reservations.storeId, storeId)]

  if (searchParams.status && searchParams.status !== 'all') {
    conditions.push(
      eq(reservations.status, searchParams.status as ReservationStatus)
    )
  }

  // Period filter
  const now = new Date()
  if (searchParams.period === 'today') {
    const startOfDay = new Date(now.setHours(0, 0, 0, 0))
    const endOfDay = new Date(now.setHours(23, 59, 59, 999))
    conditions.push(gte(reservations.startDate, startOfDay))
    conditions.push(lte(reservations.startDate, endOfDay))
  } else if (searchParams.period === 'week') {
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay())
    startOfWeek.setHours(0, 0, 0, 0)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    endOfWeek.setHours(23, 59, 59, 999)
    conditions.push(gte(reservations.startDate, startOfWeek))
    conditions.push(lte(reservations.startDate, endOfWeek))
  } else if (searchParams.period === 'month') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    endOfMonth.setHours(23, 59, 59, 999)
    conditions.push(gte(reservations.startDate, startOfMonth))
    conditions.push(lte(reservations.startDate, endOfMonth))
  }

  const reservationsList = await db.query.reservations.findMany({
    where: and(...conditions),
    with: {
      customer: true,
      items: {
        with: {
          product: true,
        },
      },
      payments: true,
    },
    orderBy: [desc(reservations.createdAt)],
    limit: 100, // Increased to show more for blurring
  })

  return reservationsList
}

async function getReservationCounts(storeId: string) {
  // Single optimized query with GROUP BY instead of 5 separate queries
  const countsByStatus = await db
    .select({
      status: reservations.status,
      count: count(),
    })
    .from(reservations)
    .where(eq(reservations.storeId, storeId))
    .groupBy(reservations.status)

  const counts: Record<string, number> = {}
  let total = 0
  for (const row of countsByStatus) {
    counts[row.status] = row.count
    total += row.count
  }

  return {
    all: total,
    pending: counts['pending'] || 0,
    confirmed: counts['confirmed'] || 0,
    ongoing: counts['ongoing'] || 0,
    completed: counts['completed'] || 0,
  }
}

function ReservationsTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="rounded-md border">
        <div className="p-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface ReservationsPageProps {
  searchParams: Promise<{ status?: string; period?: string }>
}

export default async function ReservationsPage({ searchParams }: ReservationsPageProps) {
  const store = await getCurrentStore()
  if (!store) return null

  const params = await searchParams
  const currency = store.settings?.currency || 'EUR'
  const [reservationsList, reservationCounts, limits, plan] = await Promise.all([
    getReservations(store.id, params),
    getReservationCounts(store.id),
    getStoreLimits(store.id),
    getStorePlan(store.id),
  ])

  return (
    <Suspense fallback={<ReservationsTableSkeleton />}>
      <ReservationsPageContent
        reservations={reservationsList}
        counts={reservationCounts}
        currentStatus={params.status}
        currentPeriod={params.period}
        limits={limits.reservationsThisMonth}
        planSlug={plan.slug}
        currency={currency}
      />
    </Suspense>
  )
}
