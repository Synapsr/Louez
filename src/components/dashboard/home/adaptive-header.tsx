'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Plus, ArrowRight, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Types defined inline to avoid server-only module import
type StoreState = 'virgin' | 'building' | 'starting' | 'active' | 'established'

interface StoreMetrics {
  activeProductCount: number
  pendingReservations: number
  todaysDepartures: number
  todaysReturns: number
}

interface AdaptiveHeaderProps {
  firstName: string
  timeOfDay: 'morning' | 'afternoon' | 'evening'
  storeState: StoreState
  metrics: StoreMetrics
}

export function AdaptiveHeader({
  firstName,
  timeOfDay,
  storeState,
  metrics,
}: AdaptiveHeaderProps) {
  const t = useTranslations('dashboard.home')

  // Determine greeting based on time of day
  const greeting = t(`header.greeting.${timeOfDay}`, { name: firstName })

  // Determine subtitle based on store state and metrics
  const getSubtitle = () => {
    if (storeState === 'virgin') {
      return t('header.subtitle.virgin')
    }

    if (storeState === 'building') {
      return t('header.subtitle.building', { count: metrics.activeProductCount })
    }

    if (metrics.pendingReservations > 0) {
      return t('header.subtitle.pending', { count: metrics.pendingReservations })
    }

    const todayOperations = metrics.todaysDepartures + metrics.todaysReturns
    if (todayOperations > 0) {
      return t('header.subtitle.operations', { count: todayOperations })
    }

    return t('header.subtitle.calm')
  }

  // Determine primary CTA based on state
  const getPrimaryCTA = () => {
    if (storeState === 'virgin') {
      return (
        <Button asChild>
          <Link href="/dashboard/products/new">
            <Package className="mr-2 h-4 w-4" />
            {t('header.cta.addFirstProduct')}
          </Link>
        </Button>
      )
    }

    if (metrics.pendingReservations > 0) {
      return (
        <Button asChild>
          <Link href="/dashboard/reservations?status=pending">
            {t('header.cta.handleRequests', { count: metrics.pendingReservations })}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      )
    }

    return (
      <Button asChild>
        <Link href="/dashboard/reservations/new">
          <Plus className="mr-2 h-4 w-4" />
          {t('header.cta.addReservation')}
        </Link>
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{greeting}</h1>
        <p className="text-muted-foreground">{getSubtitle()}</p>
      </div>
      {getPrimaryCTA()}
    </div>
  )
}
