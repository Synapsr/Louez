'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { orpc } from '@/lib/orpc/react'
import { CustomersFilters } from './customers-filters'
import { CustomersTable } from './customers-table'
import {
  UpgradeModal,
  LimitBanner,
  BlurOverlay,
} from '@/components/dashboard/upgrade-modal'
import type { LimitStatus } from '@/lib/plan-limits'

interface CustomersPageContentProps {
  limits: LimitStatus
  planSlug: string
  initialTotalCount: number
}

export function CustomersPageContent({
  limits,
  planSlug,
  initialTotalCount,
}: CustomersPageContentProps) {
  const t = useTranslations('dashboard.customers')
  const searchParams = useSearchParams()
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  const search = searchParams.get('search') || undefined
  const sort = searchParams.get('sort')
  const type = searchParams.get('type')

  const customersQuery = useQuery({
    ...orpc.dashboard.customers.list.queryOptions({
      input: {
        search,
        sort:
          sort === 'recent' ||
          sort === 'name' ||
          sort === 'reservations' ||
          sort === 'spent'
            ? sort
            : undefined,
        type:
          type === 'all' || type === 'individual' || type === 'business'
            ? type
            : undefined,
      },
    }),
    placeholderData: (previousData) => previousData,
  })

  const customers = customersQuery.data?.customers ?? []
  const totalCount = customersQuery.data?.totalCount ?? initialTotalCount

  // Determine which customers to show vs blur
  const displayLimit = limits.limit
  const hasLimit = displayLimit !== null
  const isOverLimit = limits.isOverLimit

  // For customers, we show the most recent ones and blur older ones
  const visibleCustomers = hasLimit && isOverLimit
    ? customers.slice(0, displayLimit)
    : customers
  const blurredCustomers = hasLimit && isOverLimit
    ? customers.slice(displayLimit)
    : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      {/* Limit Banner */}
      {hasLimit && (
        <LimitBanner
          limitType="customers"
          current={limits.current}
          limit={limits.limit!}
          currentPlan={planSlug}
          onUpgradeClick={() => setShowUpgradeModal(true)}
        />
      )}

      {/* Filters */}
      <CustomersFilters totalCount={totalCount} />

      {/* Customers Table - Visible */}
      <CustomersTable customers={visibleCustomers} />

      {/* Blurred Customers Section */}
      {blurredCustomers.length > 0 && (
        <div className="relative">
          {/* Blurred table */}
          <div className="blur-sm pointer-events-none select-none opacity-60">
            <CustomersTable customers={blurredCustomers} />
          </div>

          {/* Overlay */}
          <BlurOverlay
            limitType="customers"
            currentPlan={planSlug}
            onUpgradeClick={() => setShowUpgradeModal(true)}
          />
        </div>
      )}

      {/* Upgrade Modal */}
      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        limitType="customers"
        currentCount={limits.current}
        limit={limits.limit || 50}
        currentPlan={planSlug}
      />
    </div>
  )
}
