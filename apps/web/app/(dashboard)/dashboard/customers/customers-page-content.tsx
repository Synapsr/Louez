'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { CustomersFilters } from './customers-filters'
import { CustomersTable } from './customers-table'
import {
  UpgradeModal,
  LimitBanner,
  BlurOverlay,
} from '@/components/dashboard/upgrade-modal'
import type { LimitStatus } from '@/lib/plan-limits'

interface Customer {
  id: string
  customerType: 'individual' | 'business'
  email: string
  firstName: string
  lastName: string
  companyName: string | null
  phone: string | null
  city: string | null
  createdAt: Date
  reservationCount: number
  totalSpent: string
  lastReservation: Date | null
}

interface CustomersPageContentProps {
  customers: Customer[]
  totalCount: number
  limits: LimitStatus
  planSlug: string
}

export function CustomersPageContent({
  customers,
  totalCount,
  limits,
  planSlug,
}: CustomersPageContentProps) {
  const t = useTranslations('dashboard.customers')
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

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
