'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Plus, Lock, Calendar } from 'lucide-react'

import { Button } from '@louez/ui'
import { ReservationsTableView } from './reservations-table-view'
import { ReservationsCardView } from './reservations-card-view'
import { ReservationsFilters } from './reservations-filters'
import { ReservationsPagination } from './reservations-pagination'
import { useReservationActions, ReservationConfirmDialogs } from './reservations-actions'
import {
  UpgradeModal,
  LimitBanner,
  BlurOverlay,
} from '@/components/dashboard/upgrade-modal'
import type { LimitStatus } from '@/lib/plan-limits'
import { orpc } from '@/lib/orpc/react'
import type { Reservation, ReservationCounts, SortField, SortDirection } from './reservations-types'

interface ReservationsPageContentProps {
  currentStatus?: string
  currentPeriod?: string
  initialData?: { reservations: Reservation[]; counts: ReservationCounts; totalCount: number | null }
  limits: LimitStatus
  planSlug: string
  currency?: string
  timezone?: string
}

export function ReservationsPageContent({
  currentStatus,
  currentPeriod,
  initialData,
  limits,
  planSlug,
  currency,
  timezone,
}: ReservationsPageContentProps) {
  const t = useTranslations('dashboard.reservations')
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  // Read URL params
  const status = searchParams.get('status') || currentStatus || undefined
  const period = searchParams.get('period') || currentPeriod || undefined
  const search = searchParams.get('search') || undefined
  const view = searchParams.get('view') || 'table'
  const sortParam = searchParams.get('sort') as SortField | null
  const sortDirectionParam = searchParams.get('sortDirection') as SortDirection | null
  const pageParam = searchParams.get('page')
  const pageSizeParam = searchParams.get('pageSize')

  const currentSort = sortParam || undefined
  const currentSortDirection = sortDirectionParam || 'desc'
  const currentPage = pageParam ? parseInt(pageParam, 10) : 1
  const currentPageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 25

  // Actions hook
  const {
    loadingAction,
    handleStatusChange,
    openRejectDialog,
    confirmDialogsProps,
  } = useReservationActions()

  // Sort handler
  const handleSortChange = useCallback(
    (field: SortField) => {
      const params = new URLSearchParams(searchParams.toString())
      if (currentSort === field) {
        // Toggle direction
        const newDir = currentSortDirection === 'desc' ? 'asc' : 'desc'
        params.set('sort', field)
        params.set('sortDirection', newDir)
      } else {
        params.set('sort', field)
        params.set('sortDirection', 'desc')
      }
      params.delete('page') // reset page on sort change
      router.push(`/dashboard/reservations?${params.toString()}`)
    },
    [searchParams, currentSort, currentSortDirection, router]
  )

  const reservationsQuery = useQuery({
    ...orpc.dashboard.reservations.list.queryOptions({
      input: {
        status:
          status === 'all' ||
          status === 'pending' ||
          status === 'confirmed' ||
          status === 'ongoing' ||
          status === 'completed' ||
          status === 'cancelled' ||
          status === 'rejected'
            ? status
            : undefined,
        period: period === 'today' || period === 'week' || period === 'month' ? period : undefined,
        search: search || undefined,
        sort: currentSort,
        sortDirection: currentSortDirection as 'asc' | 'desc',
        page: currentPage,
        pageSize: currentPageSize,
      },
    }),
    initialData,
    placeholderData: (previousData) => previousData,
  })

  const reservations = reservationsQuery.data?.reservations ?? []
  const counts: ReservationCounts = reservationsQuery.data?.counts ?? {
    all: 0,
    pending: 0,
    confirmed: 0,
    ongoing: 0,
    completed: 0,
  }
  const totalCount = (reservationsQuery.data as any)?.totalCount ?? null

  // Determine which reservations to show vs blur
  const displayLimit = limits.limit
  const hasLimit = displayLimit !== null
  const isOverLimit = limits.isOverLimit
  const isAtLimit = limits.isAtLimit

  const visibleReservations = hasLimit && isOverLimit
    ? reservations.slice(0, displayLimit)
    : reservations
  const blurredReservations = hasLimit && isOverLimit
    ? reservations.slice(displayLimit)
    : []

  const handleAddReservationClick = (e: React.MouseEvent) => {
    if (isAtLimit) {
      e.preventDefault()
      setShowUpgradeModal(true)
    }
  }

  const isCardView = view === 'cards'

  // Empty state
  const isEmpty = reservations.length === 0 && !search

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-16">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
        <Calendar className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{t('noReservations')}</h3>
      <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
        {t('noReservationsDescription')}
      </p>
      <Button render={<Link href="/dashboard/reservations/new" />} className="mt-6">
        {t('createReservation')}
      </Button>
    </div>
  )

  const renderReservations = (items: Reservation[]) => {
    if (isCardView) {
      return (
        <ReservationsCardView
          reservations={items}
          currency={currency}
          timezone={timezone}
          loadingAction={loadingAction}
          handleStatusChange={handleStatusChange}
          openRejectDialog={openRejectDialog}
        />
      )
    }

    return (
      <ReservationsTableView
        reservations={items}
        currency={currency}
        timezone={timezone}
        currentSort={currentSort}
        currentSortDirection={currentSortDirection}
        onSortChange={handleSortChange}
        loadingAction={loadingAction}
        handleStatusChange={handleStatusChange}
        openRejectDialog={openRejectDialog}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        {isAtLimit ? (
          <Button onClick={() => setShowUpgradeModal(true)}>
            <Lock className="mr-2 h-4 w-4" />
            {t('addReservation')}
          </Button>
        ) : (
          <Button render={<Link href="/dashboard/reservations/new" onClick={handleAddReservationClick} />}>
              <Plus className="mr-2 h-4 w-4" />
              {t('addReservation')}
          </Button>
        )}
      </div>

      {/* Limit Banner */}
      {hasLimit && (
        <LimitBanner
          limitType="reservations"
          current={limits.current}
          limit={limits.limit!}
          currentPlan={planSlug}
          onUpgradeClick={() => setShowUpgradeModal(true)}
        />
      )}

      {/* Filters */}
      <ReservationsFilters
        counts={counts}
        currentStatus={status}
        currentPeriod={period}
      />

      {/* Reservations List */}
      {isEmpty ? (
        renderEmptyState()
      ) : (
        <>
          {renderReservations(visibleReservations)}

          {/* Blurred Reservations Section */}
          {blurredReservations.length > 0 && (
            <div className="relative">
              <div className="blur-sm pointer-events-none select-none opacity-60">
                {renderReservations(blurredReservations)}
              </div>
              <BlurOverlay
                limitType="reservations"
                currentPlan={planSlug}
                onUpgradeClick={() => setShowUpgradeModal(true)}
              />
            </div>
          )}

          {/* Pagination */}
          <ReservationsPagination
            totalCount={totalCount}
            currentPage={currentPage}
            currentPageSize={currentPageSize}
          />
        </>
      )}

      {/* Confirm Dialogs */}
      <ReservationConfirmDialogs {...confirmDialogsProps} />

      {/* Upgrade Modal */}
      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        limitType="reservations"
        currentCount={limits.current}
        limit={limits.limit || 10}
        currentPlan={planSlug}
      />
    </div>
  )
}
