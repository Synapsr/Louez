'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { format, addDays, isToday, isTomorrow } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { fr } from 'date-fns/locale'
import { cn } from '@louez/utils'
import type { BusinessHours, TimeRange } from '@louez/types'
import { isInClosurePeriod, getDaySchedule } from '@/lib/utils/business-hours'

interface StoreStatusBadgeProps {
  businessHours?: BusinessHours
  timezone?: string
  className?: string
}

interface StoreStatus {
  isOpen: boolean
  closesAt?: string
  nextOpening?: {
    day: Date
    time: string
  }
  reason?: 'closed_today' | 'closure_period' | 'outside_hours' | 'break' | 'not_configured'
}

/**
 * Find the time range that contains the given time, or null if none.
 */
function findCurrentRange(time: string, ranges: TimeRange[]): TimeRange | null {
  return ranges.find((r) => time >= r.openTime && time <= r.closeTime) ?? null
}

/**
 * Find the next range that starts after the given time, or null.
 */
function findNextRangeToday(time: string, ranges: TimeRange[]): TimeRange | null {
  return ranges.find((r) => r.openTime > time) ?? null
}

function getStoreStatus(businessHours: BusinessHours | undefined, timezone?: string): StoreStatus {
  if (!businessHours?.enabled) {
    return { isOpen: true, reason: 'not_configured' }
  }

  const now = new Date()

  // Check closure periods
  const closurePeriod = isInClosurePeriod(now, businessHours.closurePeriods)
  if (closurePeriod) {
    const nextOpening = findNextOpening(now, businessHours, timezone)
    return { isOpen: false, reason: 'closure_period', nextOpening }
  }

  // Get today's schedule (normalized with ranges)
  const daySchedule = getDaySchedule(now, businessHours, timezone)
  const currentTime = timezone
    ? formatInTimeZone(now, timezone, 'HH:mm')
    : format(now, 'HH:mm')

  if (!daySchedule.isOpen || daySchedule.ranges.length === 0) {
    const nextOpening = findNextOpening(now, businessHours, timezone)
    return { isOpen: false, reason: 'closed_today', nextOpening }
  }

  const firstRange = daySchedule.ranges[0]
  const lastRange = daySchedule.ranges[daySchedule.ranges.length - 1]

  // Before today's first opening
  if (currentTime < firstRange.openTime) {
    return {
      isOpen: false,
      reason: 'outside_hours',
      nextOpening: { day: now, time: firstRange.openTime },
    }
  }

  // After today's last closing
  if (currentTime > lastRange.closeTime) {
    const nextOpening = findNextOpening(now, businessHours, timezone)
    return { isOpen: false, reason: 'outside_hours', nextOpening }
  }

  // Check if currently in an open range
  const currentRange = findCurrentRange(currentTime, daySchedule.ranges)
  if (currentRange) {
    return { isOpen: true, closesAt: currentRange.closeTime }
  }

  // Between two ranges (break / pause)
  const nextRange = findNextRangeToday(currentTime, daySchedule.ranges)
  if (nextRange) {
    return {
      isOpen: false,
      reason: 'break',
      nextOpening: { day: now, time: nextRange.openTime },
    }
  }

  // Fallback
  const nextOpening = findNextOpening(now, businessHours, timezone)
  return { isOpen: false, reason: 'outside_hours', nextOpening }
}

function findNextOpening(
  fromDate: Date,
  businessHours: BusinessHours,
  timezone?: string
): { day: Date; time: string } | undefined {
  for (let i = 0; i < 14; i++) {
    const checkDate = i === 0 ? fromDate : addDays(fromDate, i)

    if (isInClosurePeriod(checkDate, businessHours.closurePeriods)) {
      continue
    }

    const daySchedule = getDaySchedule(checkDate, businessHours, timezone)

    if (daySchedule.isOpen && daySchedule.ranges.length > 0) {
      const currentTime = timezone
        ? formatInTimeZone(fromDate, timezone, 'HH:mm')
        : format(fromDate, 'HH:mm')

      if (i === 0) {
        // Same day: find next range that hasn't closed yet
        const nextRange = daySchedule.ranges.find((r) => r.openTime > currentTime)
        if (nextRange) {
          return { day: checkDate, time: nextRange.openTime }
        }
      } else {
        // Future day: return first range
        return { day: checkDate, time: daySchedule.ranges[0].openTime }
      }
    }
  }

  return undefined
}

function formatNextOpening(nextOpening: { day: Date; time: string }, t: (key: string) => string): string {
  const { day, time } = nextOpening

  const [hours, minutes] = time.split(':')
  const formattedTime = `${parseInt(hours)}h${minutes}`

  if (isToday(day)) {
    return `${t('opensAt')} ${formattedTime}`
  }

  if (isTomorrow(day)) {
    return `${t('opensTomorrow')} ${formattedTime}`
  }

  const dayName = format(day, 'EEEE', { locale: fr })
  return `${t('opensOn')} ${dayName} ${formattedTime}`
}

export function StoreStatusBadge({ businessHours, timezone, className }: StoreStatusBadgeProps) {
  const t = useTranslations('storefront.status')
  const [status, setStatus] = useState<StoreStatus>(() => getStoreStatus(businessHours, timezone))

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getStoreStatus(businessHours, timezone))
    }, 60000)

    return () => clearInterval(interval)
  }, [businessHours, timezone])

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
