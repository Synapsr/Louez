'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { cn, formatDateShort } from '@louez/utils'
import { Badge } from '@louez/ui'
import { Button } from '@louez/ui'
import { ReservationBar } from './reservation-bar'
import {
  calculateWeekLayout,
  getWeekDays,
  reservationIncludesDay,
  isSameDay,
} from './calendar-utils'
import type { Reservation, SpanningReservation } from './types'

// =============================================================================
// Constants
// =============================================================================

const BAR_HEIGHT = 28
const BAR_GAP = 4
const SPANNING_AREA_PADDING = 8
const MIN_DAY_HEIGHT = 140

// =============================================================================
// Types
// =============================================================================

interface WeekViewProps {
  reservations: Reservation[]
  currentDate: Date
  selectedProductId?: string
}

// =============================================================================
// Component
// =============================================================================

export function WeekView({
  reservations,
  currentDate,
  selectedProductId,
}: WeekViewProps) {
  const t = useTranslations('dashboard.calendar')

  // Get week days (Monday to Sunday)
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate])

  // Filter reservations by product if selected
  const filteredReservations = useMemo(() => {
    if (!selectedProductId || selectedProductId === 'all') {
      return reservations
    }
    return reservations.filter((r) =>
      r.items.some((item) => item.product?.id === selectedProductId)
    )
  }, [reservations, selectedProductId])

  // Calculate week layout with spanning reservations
  const weekLayout = useMemo(
    () => calculateWeekLayout(filteredReservations, weekDays[0]),
    [filteredReservations, weekDays]
  )

  // Calculate the height of the spanning area
  const spanningAreaHeight =
    weekLayout.maxRows > 0
      ? weekLayout.maxRows * (BAR_HEIGHT + BAR_GAP) + SPANNING_AREA_PADDING * 2
      : 0

  // Day names
  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Day Headers */}
      <div className="grid grid-cols-7 border-b bg-muted/30">
        {weekDays.map((day, index) => {
          const isToday = isSameDay(day, new Date())
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          const dayReservations = filteredReservations.filter((r) =>
            reservationIncludesDay(r, day)
          )

          return (
            <div
              key={index}
              className={cn(
                'flex flex-col items-center border-r p-3 last:border-r-0',
                isWeekend && 'bg-muted/20'
              )}
            >
              <span
                className={cn(
                  'text-xs font-medium uppercase tracking-wide',
                  isWeekend ? 'text-muted-foreground' : 'text-muted-foreground'
                )}
              >
                {t(`dayNames.${dayNames[index]}`)}
              </span>
              <span
                className={cn(
                  'mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                  isToday
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground'
                )}
              >
                {day.getDate()}
              </span>
              {dayReservations.length > 0 && (
                <Badge variant="secondary" className="mt-1 text-xs">
                  {dayReservations.length}
                </Badge>
              )}
            </div>
          )
        })}
      </div>

      {/* Spanning Reservations Area */}
      {weekLayout.maxRows > 0 && (
        <div
          className="relative border-b bg-muted/10"
          style={{ height: spanningAreaHeight }}
        >
          {/* Grid lines for visual alignment */}
          <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
            {weekDays.map((day, index) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              return (
                <div
                  key={index}
                  className={cn(
                    'border-r last:border-r-0',
                    isWeekend && 'bg-muted/10'
                  )}
                />
              )
            })}
          </div>

          {/* Reservation bars */}
          {weekLayout.spanningReservations.map((spanning) => (
            <SpanningBar key={spanning.reservation.id} spanning={spanning} />
          ))}
        </div>
      )}

      {/* Day Columns with non-spanning content */}
      <div className="grid grid-cols-7" style={{ minHeight: MIN_DAY_HEIGHT }}>
        {weekDays.map((day, dayIndex) => {
          const isToday = isSameDay(day, new Date())
          const isWeekend = day.getDay() === 0 || day.getDay() === 6

          // Get single-day reservations for this day (not shown in spanning area)
          const singleDayReservations = filteredReservations.filter((r) => {
            const start = new Date(r.startDate)
            const end = new Date(r.endDate)
            return (
              isSameDay(start, day) &&
              isSameDay(end, day) &&
              reservationIncludesDay(r, day)
            )
          })

          return (
            <div
              key={dayIndex}
              className={cn(
                'relative border-r p-2 last:border-r-0',
                isWeekend && 'bg-muted/10',
                isToday && 'bg-primary/5'
              )}
              style={{ minHeight: MIN_DAY_HEIGHT }}
            >
              {/* Single-day reservations */}
              <div className="space-y-1">
                {singleDayReservations.slice(0, 5).map((reservation) => (
                  <ReservationBar
                    key={reservation.id}
                    reservation={reservation}
                    compact
                  />
                ))}
                {singleDayReservations.length > 5 && (
                  <span className="block text-center text-xs text-muted-foreground">
                    {t('moreItems', { count: singleDayReservations.length - 5 })}
                  </span>
                )}
              </div>

              {/* Today indicator */}
              {isToday && (
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="h-0.5 rounded-full bg-primary" />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =============================================================================
// Spanning Bar Component
// =============================================================================

interface SpanningBarProps {
  spanning: SpanningReservation
}

function SpanningBar({ spanning }: SpanningBarProps) {
  const { reservation, startDayIndex, endDayIndex, row, continuesBefore, continuesAfter } =
    spanning

  // Calculate position as percentages
  const leftPercent = (startDayIndex / 7) * 100
  const widthPercent = ((endDayIndex - startDayIndex + 1) / 7) * 100

  // Add small margins within the cell
  const marginPercent = 0.5 // 0.5% margin on each side

  return (
    <ReservationBar
      reservation={reservation}
      continuesBefore={continuesBefore}
      continuesAfter={continuesAfter}
      compact
      className="absolute"
      style={{
        left: `calc(${leftPercent}% + ${continuesBefore ? 0 : 4}px)`,
        width: `calc(${widthPercent}% - ${(continuesBefore ? 0 : 4) + (continuesAfter ? 0 : 4)}px)`,
        top: SPANNING_AREA_PADDING + row * (BAR_HEIGHT + BAR_GAP),
        height: BAR_HEIGHT,
      }}
    />
  )
}
