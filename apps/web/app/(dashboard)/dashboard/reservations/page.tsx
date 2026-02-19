import { Suspense } from 'react'
import { getCurrentStore } from '@/lib/store-context'

import { getStoreLimits, getStorePlan } from '@/lib/plan-limits'
import { getDashboardReservationsList } from '@louez/api/services'
import { Skeleton } from '@louez/ui'
import { ReservationsPageContent } from './reservations-page-content'

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
  searchParams: Promise<{
    status?: string
    period?: string
    search?: string
    sort?: string
    sortDirection?: string
    page?: string
    pageSize?: string
    view?: string
  }>
}

function normalizeStatus(value: string | undefined) {
  if (
    value === 'all' ||
    value === 'pending' ||
    value === 'confirmed' ||
    value === 'ongoing' ||
    value === 'completed' ||
    value === 'cancelled' ||
    value === 'rejected'
  ) {
    return value
  }
  return undefined
}

function normalizePeriod(value: string | undefined) {
  if (value === 'today' || value === 'week' || value === 'month') return value
  return undefined
}

function normalizeSort(value: string | undefined) {
  if (value === 'startDate' || value === 'amount' || value === 'status' || value === 'number') return value
  return undefined
}

function normalizeSortDirection(value: string | undefined) {
  if (value === 'asc' || value === 'desc') return value
  return undefined
}

export default async function ReservationsPage({ searchParams }: ReservationsPageProps) {
  const store = await getCurrentStore()
  if (!store) return null

  const params = await searchParams
  const status = normalizeStatus(params.status)
  const period = normalizePeriod(params.period)
  const search = params.search?.trim() || undefined
  const sort = normalizeSort(params.sort)
  const sortDirection = normalizeSortDirection(params.sortDirection)
  const page = params.page ? parseInt(params.page, 10) : 1
  const pageSize = params.pageSize ? parseInt(params.pageSize, 10) : 25
  const currency = store.settings?.currency || 'EUR'
  const timezone = store.settings?.timezone

  const [limits, plan] = await Promise.all([
    getStoreLimits(store.id),
    getStorePlan(store.id),
  ])

  const initialData = await getDashboardReservationsList({
    storeId: store.id,
    status,
    period,
    limit: 100,
    search,
    sort,
    sortDirection,
    page,
    pageSize,
  })

  return (
    <Suspense fallback={<ReservationsTableSkeleton />}>
      <ReservationsPageContent
        currentStatus={status}
        currentPeriod={period}
        initialData={initialData}
        limits={limits.reservationsThisMonth}
        planSlug={plan.slug}
        currency={currency}
        timezone={timezone}
      />
    </Suspense>
  )
}
