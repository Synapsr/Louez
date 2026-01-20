'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ReservationBar } from './reservation-bar'
import {
  reservationIncludesDay,
  isSameDay,
  startOfDay,
  endOfDay,
} from './calendar-utils'
import type { Reservation, ReservationStatus } from './types'

// =============================================================================
// Constants
// =============================================================================

const MIN_DAY_HEIGHT = 100
const MAX_ITEMS_SHOWN = 3

// =============================================================================
// Types
// =============================================================================

interface MonthViewProps {
  reservations: Reservation[]
  currentDate: Date
  selectedProductId?: string
}

// =============================================================================
// Component
// =============================================================================

export function MonthView({
  reservations,
  currentDate,
  selectedProductId,
}: MonthViewProps) {
  const t = useTranslations('dashboard.calendar')

  // Day names
  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  // Calculate display days for the month
  const displayDays = useMemo(() => {
    const days: Date[] = []
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    // Start from Monday of the first week
    const startDayOfWeek = firstDay.getDay()
    const startDiff = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek
    const viewStart = new Date(firstDay)
    viewStart.setDate(firstDay.getDate() + startDiff)

    // Generate 5-6 weeks
    const weeks = Math.ceil((lastDay.getDate() + Math.abs(startDiff)) / 7)
    for (let i = 0; i < weeks * 7; i++) {
      const day = new Date(viewStart)
      day.setDate(viewStart.getDate() + i)
      days.push(day)
    }

    return days
  }, [currentDate])

  // Filter reservations by product if selected
  const filteredReservations = useMemo(() => {
    if (!selectedProductId || selectedProductId === 'all') {
      return reservations
    }
    return reservations.filter((r) =>
      r.items.some((item) => item.product?.id === selectedProductId)
    )
  }, [reservations, selectedProductId])

  // Get reservations for a specific day with position info
  const getReservationsForDay = (day: Date) => {
    return filteredReservations.filter((r) => reservationIncludesDay(r, day))
  }

  // Check if a reservation starts on this day
  const isReservationStart = (reservation: Reservation, day: Date): boolean => {
    const resStart = startOfDay(new Date(reservation.startDate))
    const dayStart = startOfDay(day)
    return resStart.getTime() === dayStart.getTime()
  }

  // Check if a reservation ends on this day
  const isReservationEnd = (reservation: Reservation, day: Date): boolean => {
    const resEnd = startOfDay(new Date(reservation.endDate))
    const dayStart = startOfDay(day)
    return resEnd.getTime() === dayStart.getTime()
  }

  // Check if day is in current month
  const isCurrentMonth = (day: Date) => {
    return day.getMonth() === currentDate.getMonth()
  }

  // Check if day is today
  const isToday = (day: Date) => {
    return isSameDay(day, new Date())
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Day Headers */}
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {dayNames.map((name, index) => {
          const isWeekend = index >= 5
          return (
            <div
              key={name}
              className={cn(
                'border-r p-3 text-center text-sm font-medium last:border-r-0',
                isWeekend
                  ? 'bg-muted/20 text-muted-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {t(`dayNames.${name}`)}
            </div>
          )
        })}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7">
        {displayDays.map((day, index) => {
          const dayReservations = getReservationsForDay(day)
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          const inCurrentMonth = isCurrentMonth(day)
          const today = isToday(day)

          return (
            <div
              key={index}
              className={cn(
                'relative border-b border-r p-2 last:border-r-0',
                index % 7 === 6 && 'border-r-0',
                isWeekend && 'bg-muted/10',
                !inCurrentMonth && 'bg-muted/30',
                today && 'bg-primary/5'
              )}
              style={{ minHeight: MIN_DAY_HEIGHT }}
            >
              {/* Day Number */}
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-full text-sm',
                    today
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : !inCurrentMonth
                        ? 'text-muted-foreground/50'
                        : 'font-medium'
                  )}
                >
                  {day.getDate()}
                </span>
                {dayReservations.length > 0 && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-xs',
                      !inCurrentMonth && 'opacity-50'
                    )}
                  >
                    {dayReservations.length}
                  </Badge>
                )}
              </div>

              {/* Reservations */}
              <div className="space-y-1">
                {dayReservations.slice(0, MAX_ITEMS_SHOWN).map((reservation) => {
                  const isStart = isReservationStart(reservation, day)
                  const isEnd = isReservationEnd(reservation, day)
                  const continuesBefore = !isStart
                  const continuesAfter = !isEnd

                  return (
                    <ReservationBar
                      key={reservation.id}
                      reservation={reservation}
                      continuesBefore={continuesBefore}
                      continuesAfter={continuesAfter}
                      compact
                      className={cn(
                        !inCurrentMonth && 'opacity-60'
                      )}
                    />
                  )
                })}
                {dayReservations.length > MAX_ITEMS_SHOWN && (
                  <Link
                    href={`/dashboard/reservations?date=${day.toISOString().split('T')[0]}`}
                    className="block text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('moreItems', {
                      count: dayReservations.length - MAX_ITEMS_SHOWN,
                    })}
                  </Link>
                )}
              </div>

              {/* Today indicator line */}
              {today && (
                <div className="absolute bottom-1 left-1 right-1">
                  <div className="h-0.5 rounded-full bg-primary/50" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
