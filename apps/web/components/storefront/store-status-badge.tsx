'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays, isToday, isTomorrow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@louez/utils'
import type { BusinessHours } from '@louez/types'
import { isInClosurePeriod, getDaySchedule } from '@/lib/utils/business-hours'

interface StoreStatusBadgeProps {
  businessHours?: BusinessHours
  className?: string
}

interface StoreStatus {
  isOpen: boolean
  closesAt?: string
  nextOpening?: {
    day: Date
    time: string
  }
  reason?: 'closed_today' | 'closure_period' | 'outside_hours' | 'not_configured'
}

function getStoreStatus(businessHours: BusinessHours | undefined): StoreStatus {
  if (!businessHours?.enabled) {
    return { isOpen: true, reason: 'not_configured' }
  }

  const now = new Date()

  // Check closure periods
  const closurePeriod = isInClosurePeriod(now, businessHours.closurePeriods)
  if (closurePeriod) {
    // Find next opening after closure period
    const nextOpening = findNextOpening(now, businessHours)
    return { isOpen: false, reason: 'closure_period', nextOpening }
  }

  // Get today's schedule
  const daySchedule = getDaySchedule(now, businessHours)
  const currentTime = format(now, 'HH:mm')

  if (!daySchedule.isOpen) {
    // Store is closed today, find next opening
    const nextOpening = findNextOpening(now, businessHours)
    return { isOpen: false, reason: 'closed_today', nextOpening }
  }

  // Check if before opening time
  if (currentTime < daySchedule.openTime) {
    return {
      isOpen: false,
      reason: 'outside_hours',
      nextOpening: { day: now, time: daySchedule.openTime }
    }
  }

  // Check if after closing time
  if (currentTime > daySchedule.closeTime) {
    const nextOpening = findNextOpening(now, businessHours)
    return { isOpen: false, reason: 'outside_hours', nextOpening }
  }

  // Store is open
  return { isOpen: true, closesAt: daySchedule.closeTime }
}

function findNextOpening(fromDate: Date, businessHours: BusinessHours): { day: Date; time: string } | undefined {
  // Search up to 14 days ahead
  for (let i = 0; i < 14; i++) {
    const checkDate = i === 0 ? fromDate : addDays(fromDate, i)

    // Skip if in closure period
    if (isInClosurePeriod(checkDate, businessHours.closurePeriods)) {
      continue
    }

    const daySchedule = getDaySchedule(checkDate, businessHours)

    if (daySchedule.isOpen) {
      const currentTime = format(fromDate, 'HH:mm')

      // If it's today and we haven't passed opening time yet
      if (i === 0 && currentTime < daySchedule.openTime) {
        return { day: checkDate, time: daySchedule.openTime }
      }

      // If it's a future day
      if (i > 0) {
        return { day: checkDate, time: daySchedule.openTime }
      }
    }
  }

  return undefined
}

function formatNextOpening(nextOpening: { day: Date; time: string }, t: (key: string) => string): string {
  const { day, time } = nextOpening

  // Format time without leading zeros for hours (9h00 instead of 09h00)
  const [hours, minutes] = time.split(':')
  const formattedTime = `${parseInt(hours)}h${minutes}`

  if (isToday(day)) {
    return `${t('opensAt')} ${formattedTime}`
  }

  if (isTomorrow(day)) {
    return `${t('opensTomorrow')} ${formattedTime}`
  }

  // Show day name for other days
  const dayName = format(day, 'EEEE', { locale: fr })
  return `${t('opensOn')} ${dayName} ${formattedTime}`
}

export function StoreStatusBadge({ businessHours, className }: StoreStatusBadgeProps) {
  const t = useTranslations('storefront.status')
  const [status, setStatus] = useState<StoreStatus>(() => getStoreStatus(businessHours))

  // Update status every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getStoreStatus(businessHours))
    }, 60000)

    return () => clearInterval(interval)
  }, [businessHours])

  // Don't show badge if business hours aren't configured
  if (status.reason === 'not_configured') {
    return null
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
        status.isOpen
          ? 'bg-green-500/20 text-green-700 dark:text-green-400'
          : 'bg-red-500/20 text-red-700 dark:text-red-400',
        className
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          status.isOpen ? 'bg-green-500 animate-pulse' : 'bg-red-500'
        )}
      />
      <span>
        {status.isOpen ? (
          <>
            {t('open')}
            {status.closesAt && (
              <span className="opacity-75 ml-1">
                · {t('until')} {parseInt(status.closesAt.split(':')[0])}h{status.closesAt.split(':')[1]}
              </span>
            )}
          </>
        ) : (
          <>
            {t('closed')}
            {status.nextOpening && (
              <span className="opacity-75 ml-1">
                · {formatNextOpening(status.nextOpening, t)}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  )
}
