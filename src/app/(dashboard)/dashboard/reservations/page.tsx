import { Suspense } from 'react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { reservations } from '@/lib/db/schema'
import { eq, desc, and, count, gte, lte } from 'drizzle-orm'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ReservationsTable } from './reservations-table'
import { ReservationsFilters } from './reservations-filters'

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
    limit: 50,
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

  const t = await getTranslations('dashboard.reservations')

  const params = await searchParams
  const currency = store.settings?.currency || 'EUR'
  const [reservationsList, reservationCounts] = await Promise.all([
    getReservations(store.id, params),
    getReservationCounts(store.id),
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/reservations/new">
            <Plus className="mr-2 h-4 w-4" />
            {t('addReservation')}
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <ReservationsFilters
        counts={reservationCounts}
        currentStatus={params.status}
        currentPeriod={params.period}
      />

      {/* Reservations Table */}
      <Suspense fallback={<ReservationsTableSkeleton />}>
        <ReservationsTable reservations={reservationsList} currency={currency} />
      </Suspense>
    </div>
  )
}
