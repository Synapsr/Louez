'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { fromZonedTime } from 'date-fns-tz'

import { orpc } from '@/lib/orpc/react'
import { CUSTOMER_ACQUISITION_SOURCES, CUSTOMER_CREATED_VIA } from '@louez/types'

import { CustomersFilters } from './customers-filters'
import { CustomersPageHeading } from './customers-page-heading'
import { CUSTOMER_PAGE_SIZES, CustomersPagination } from './customers-pagination'
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
  timezone: string
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The instant a calendar day starts in the store's timezone, shifted by whole days. */
const toStoreDayStart = (day: string | null, timezone: string, addDays = 0): Date | undefined => {
  if (!day || !ISO_DAY.test(day)) return undefined
  const shifted = new Date(`${day}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + addDays)
  return fromZonedTime(`${shifted.toISOString().slice(0, 10)}T00:00:00`, timezone)
}

export function CustomersPageContent({
  limits,
  planSlug,
  initialTotalCount,
  timezone,
}: CustomersPageContentProps) {
  const searchParams = useSearchParams()
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  const search = searchParams.get('search') || undefined
  const sort = searchParams.get('sort')
  const type = searchParams.get('type')
  const source = CUSTOMER_ACQUISITION_SOURCES.find((value) => value === searchParams.get('source'))
  const channel = CUSTOMER_CREATED_VIA.find((value) => value === searchParams.get('channel'))
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const pageSize =
    CUSTOMER_PAGE_SIZES.find((size) => String(size) === searchParams.get('pageSize')) ?? 25

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
        source,
        channel,
        // The end day is inclusive: the bound is the start of the next one.
        createdFrom: toStoreDayStart(searchParams.get('createdFrom'), timezone),
        createdTo: toStoreDayStart(searchParams.get('createdTo'), timezone, 1),
        page,
        pageSize,
      },
    }),
    placeholderData: (previousData) => previousData,
  })

  const customers = customersQuery.data?.customers ?? []
  const totalCount = customersQuery.data?.totalCount ?? initialTotalCount
  const filteredCount = customersQuery.data?.filteredCount ?? null
  const listFields = customersQuery.data?.listFields ?? []

  // Determine which customers to show vs blur
  const displayLimit = limits.limit
  const hasLimit = displayLimit !== null
  const isOverLimit = limits.isOverLimit

  // For customers, we show the most recent ones and blur older ones. The cut
  // is counted across pages: a row's rank is its position in the whole list.
  const visibleOnPage =
    hasLimit && isOverLimit ? Math.max(0, displayLimit - (page - 1) * pageSize) : customers.length
  const visibleCustomers = customers.slice(0, visibleOnPage)
  const blurredCustomers = customers.slice(visibleOnPage)

  return (
    <div className="space-y-6">
      {/* Header */}
      <CustomersPageHeading />

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
      <CustomersFilters totalCount={totalCount} filteredCount={filteredCount} />

      {/* Customers Table - Visible */}
      {(visibleCustomers.length > 0 || blurredCustomers.length === 0) && (
        <CustomersTable customers={visibleCustomers} listFields={listFields} />
      )}

      {/* Blurred Customers Section */}
      {blurredCustomers.length > 0 && (
        <div className="relative">
          {/* Blurred table */}
          <div className="blur-sm pointer-events-none select-none opacity-60">
            <CustomersTable customers={blurredCustomers} listFields={listFields} />
          </div>

          {/* Overlay */}
          <BlurOverlay
            limitType="customers"
            currentPlan={planSlug}
            onUpgradeClick={() => setShowUpgradeModal(true)}
          />
        </div>
      )}

      <CustomersPagination
        totalCount={filteredCount ?? totalCount}
        page={page}
        pageSize={pageSize}
      />

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
