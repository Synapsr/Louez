'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Plus, Lock } from 'lucide-react'

import { Button } from '@louez/ui'
import { ReservationsTable } from './reservations-table'
import { ReservationsFilters } from './reservations-filters'
import {
  UpgradeModal,
  LimitBanner,
  BlurOverlay,
} from '@/components/dashboard/upgrade-modal'
import type { LimitStatus } from '@/lib/plan-limits'
import { orpc } from '@/lib/orpc/react'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface ReservationItem {
  id: string
  quantity: number
  isCustomItem: boolean
  productSnapshot: {
    name: string
  }
  product: {
    id: string
    name: string
  } | null
}

interface Payment {
  id: string
  amount: string
  type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'deposit_hold' | 'deposit_capture' | 'adjustment'
  method: 'cash' | 'card' | 'transfer' | 'check' | 'other' | 'stripe'
  status: 'pending' | 'completed' | 'failed' | 'refunded' | 'authorized' | 'cancelled'
}

interface Reservation {
  id: string
  number: string
  status: ReservationStatus | null
  startDate: Date
  endDate: Date
  subtotalAmount: string
  depositAmount: string
  totalAmount: string
  customer: {
    id: string
    firstName: string
    lastName: string
    email: string
  }
  items: ReservationItem[]
  payments: Payment[]
}

interface ReservationCounts {
  all: number
  pending: number
  confirmed: number
  ongoing: number
  completed: number
}

interface ReservationsPageContentProps {
  currentStatus?: string
  currentPeriod?: string
  initialData?: { reservations: Reservation[]; counts: ReservationCounts }
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

  const status = searchParams.get('status') || currentStatus || undefined
  const period = searchParams.get('period') || currentPeriod || undefined

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
        limit: 100,
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

  // Determine which reservations to show vs blur
  const displayLimit = limits.limit
  const hasLimit = displayLimit !== null
  const isOverLimit = limits.isOverLimit
  const isAtLimit = limits.isAtLimit

  // For reservations, we show the most recent ones and blur older ones
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

      {/* Reservations Table - Visible */}
      <ReservationsTable reservations={visibleReservations} currency={currency} timezone={timezone} />

      {/* Blurred Reservations Section */}
      {blurredReservations.length > 0 && (
        <div className="relative">
          {/* Blurred table */}
          <div className="blur-sm pointer-events-none select-none opacity-60">
            <ReservationsTable reservations={blurredReservations} currency={currency} timezone={timezone} />
          </div>

          {/* Overlay */}
          <BlurOverlay
            limitType="reservations"
            currentPlan={planSlug}
            onUpgradeClick={() => setShowUpgradeModal(true)}
          />
        </div>
      )}

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
