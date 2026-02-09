'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { cn, formatCurrency } from '@louez/utils'
import { Badge } from '@louez/ui'
import { Tooltip, TooltipContent, TooltipTrigger } from '@louez/ui'
import {
  reservationIncludesDay,
  isSameDay,
  startOfDay,
} from './calendar-utils'
import type { Reservation, ReservationStatus } from './types'

// =============================================================================
// Constants
// =============================================================================

const MIN_DAY_HEIGHT = 120
const MAX_TRACKS = 3 // Maximum number of reservation rows per day
const BAR_HEIGHT = 22
const BAR_GAP = 2
const DAY_HEADER_HEIGHT = 32

// Status colors matching the reservation-bar component
const STATUS_COLORS: Record<ReservationStatus, string> = {
  pending: 'bg-amber-500/90 border-amber-600',
  confirmed: 'bg-emerald-500/90 border-emerald-600',
  ongoing: 'bg-blue-500/90 border-blue-600',
  completed: 'bg-slate-400/90 border-slate-500',
  cancelled: 'bg-rose-400/90 border-rose-500',
  rejected: 'bg-slate-300/90 border-slate-400',
}

// =============================================================================
// Types
// =============================================================================

interface MonthViewProps {
  reservations: Reservation[]
  currentDate: Date
  selectedProductId?: string
}

interface WeekReservation {
  reservation: Reservation
  startCol: number // 0-6 (Monday-Sunday)
  endCol: number // 0-6 (Monday-Sunday)
  track: number // Vertical position (row within the day)
  continuesBefore: boolean
  continuesAfter: boolean
}

// =============================================================================
// Utility functions
// =============================================================================

function getWeekBounds(weekStart: Date): { start: Date; end: Date } {
  const start = startOfDay(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function getReservationWeekSpan(
  reservation: Reservation,
  weekStart: Date
): { startCol: number; endCol: number; continuesBefore: boolean; continuesAfter: boolean } | null {
  const { start: weekStartDate, end: weekEndDate } = getWeekBounds(weekStart)

  const resStart = startOfDay(new Date(reservation.startDate))
  const resEnd = startOfDay(new Date(reservation.endDate))

  // Check if reservation overlaps with this week
  if (resEnd < weekStartDate || resStart > weekEndDate) {
    return null
  }

  // Calculate columns (0 = Monday, 6 = Sunday)
  const effectiveStart = resStart < weekStartDate ? weekStartDate : resStart
  const effectiveEnd = resEnd > weekEndDate ? weekEndDate : resEnd

  const startCol = Math.floor((effectiveStart.getTime() - weekStartDate.getTime()) / (24 * 60 * 60 * 1000))
  const endCol = Math.floor((effectiveEnd.getTime() - weekStartDate.getTime()) / (24 * 60 * 60 * 1000))

  return {
    startCol: Math.max(0, Math.min(6, startCol)),
    endCol: Math.max(0, Math.min(6, endCol)),
    continuesBefore: resStart < weekStartDate,
    continuesAfter: resEnd > weekEndDate,
  }
}

function assignTracksToWeek(
  reservations: Reservation[],
  weekStart: Date
): WeekReservation[] {
  const weekReservations: WeekReservation[] = []
  const tracks: boolean[][] = Array.from({ length: MAX_TRACKS }, () => Array(7).fill(false))

  // Sort reservations by start date, then by duration (longer first)
  const sortedReservations = [...reservations].sort((a, b) => {
    const aStart = new Date(a.startDate).getTime()
    const bStart = new Date(b.startDate).getTime()
    if (aStart !== bStart) return aStart - bStart

    const aDuration = new Date(a.endDate).getTime() - aStart
    const bDuration = new Date(b.endDate).getTime() - bStart
    return bDuration - aDuration // Longer reservations first
  })

  for (const reservation of sortedReservations) {
    const span = getReservationWeekSpan(reservation, weekStart)
    if (!span) continue

    // Find available track
    let assignedTrack = -1
    for (let track = 0; track < MAX_TRACKS; track++) {
      let available = true
      for (let col = span.startCol; col <= span.endCol; col++) {
        if (tracks[track][col]) {
          available = false
          break
        }
      }
      if (available) {
        assignedTrack = track
        break
      }
    }

    if (assignedTrack >= 0) {
      // Mark track as occupied
      for (let col = span.startCol; col <= span.endCol; col++) {
        tracks[assignedTrack][col] = true
      }

      weekReservations.push({
        reservation,
        startCol: span.startCol,
        endCol: span.endCol,
        track: assignedTrack,
        continuesBefore: span.continuesBefore,
        continuesAfter: span.continuesAfter,
      })
    }
  }

  return weekReservations
}

function getOverflowCount(
  reservations: Reservation[],
  day: Date,
  weekReservations: WeekReservation[]
): number {
  // Count reservations that appear on this day
  const dayReservations = reservations.filter(r => reservationIncludesDay(r, day))

  // Count reservations that are displayed (have an assigned track)
  const displayedOnDay = weekReservations.filter(wr => {
    const dayCol = day.getDay() === 0 ? 6 : day.getDay() - 1 // Convert to Mon=0, Sun=6
    return wr.startCol <= dayCol && wr.endCol >= dayCol
  })

  return Math.max(0, dayReservations.length - displayedOnDay.length)
}

// =============================================================================
// Sub-components
// =============================================================================

function SpanningReservationBar({
  weekReservation,
}: {
  weekReservation: WeekReservation
}) {
  const { reservation, startCol, endCol, track, continuesBefore, continuesAfter } = weekReservation
  const t = useTranslations('dashboard.calendar')

  // Calculate position and width
  const leftPercent = (startCol / 7) * 100
  const widthPercent = ((endCol - startCol + 1) / 7) * 100
  const topOffset = DAY_HEADER_HEIGHT + track * (BAR_HEIGHT + BAR_GAP)

  const statusColor = STATUS_COLORS[reservation.status as ReservationStatus] || STATUS_COLORS.pending
  const customerName = `${reservation.customer?.firstName || ''} ${reservation.customer?.lastName || ''}`.trim() || t('noCustomer')

  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link
          href={`/dashboard/reservations/${reservation.id}`}
          className={cn(
            'absolute flex items-center gap-1.5 px-2 text-xs font-medium text-white transition-all',
            'hover:brightness-110 hover:shadow-md',
            'overflow-hidden whitespace-nowrap',
            statusColor,
            continuesBefore ? 'rounded-l-none border-l-0' : 'rounded-l-md border-l',
            continuesAfter ? 'rounded-r-none border-r-0' : 'rounded-r-md border-r'
          )}
          style={{
            left: `calc(${leftPercent}% + ${continuesBefore ? 0 : 4}px)`,
            width: `calc(${widthPercent}% - ${(continuesBefore ? 0 : 4) + (continuesAfter ? 0 : 4)}px)`,
            top: topOffset,
            height: BAR_HEIGHT,
          }}
        />}
      >
          {continuesBefore && (
            <span className="mr-0.5 text-white/70">◂</span>
          )}
          <span className="truncate">{customerName}</span>
          {reservation.number && (
            <span className="shrink-0 text-white/70">#{reservation.number}</span>
          )}
          {continuesAfter && (
            <span className="ml-auto text-white/70">▸</span>
          )}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1">
          <div className="font-medium">{customerName}</div>
          {reservation.number && (
            <div className="text-xs text-muted-foreground">#{reservation.number}</div>
          )}
          <div className="text-xs">
            {new Date(reservation.startDate).toLocaleDateString()} - {new Date(reservation.endDate).toLocaleDateString()}
          </div>
          {reservation.totalAmount && (
            <div className="text-xs font-medium">{formatCurrency(Number(reservation.totalAmount))}</div>
          )}
          <Badge variant="outline" className="text-xs">
            {t(`status.${reservation.status}`)}
          </Badge>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function MonthView({
  reservations,
  currentDate,
  selectedProductId,
}: MonthViewProps) {
  const t = useTranslations('dashboard.calendar')

  // Day names
  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  // Calculate weeks for the month
  const weeks = useMemo(() => {
    const result: Date[][] = []
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    // Start from Monday of the first week
    const startDayOfWeek = firstDay.getDay()
    const startDiff = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek
    const viewStart = new Date(firstDay)
    viewStart.setDate(firstDay.getDate() + startDiff)

    // Generate weeks
    const totalWeeks = Math.ceil((lastDay.getDate() + Math.abs(startDiff)) / 7)
    for (let week = 0; week < totalWeeks; week++) {
      const weekDays: Date[] = []
      for (let day = 0; day < 7; day++) {
        const date = new Date(viewStart)
        date.setDate(viewStart.getDate() + week * 7 + day)
        weekDays.push(date)
      }
      result.push(weekDays)
    }

    return result
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

  // Pre-compute week reservations for each week
  const weekReservationsMap = useMemo(() => {
    const map = new Map<number, WeekReservation[]>()
    weeks.forEach((weekDays, weekIndex) => {
      const weekStart = weekDays[0]
      map.set(weekIndex, assignTracksToWeek(filteredReservations, weekStart))
    })
    return map
  }, [weeks, filteredReservations])

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

      {/* Calendar Grid - Week by Week */}
      {weeks.map((weekDays, weekIndex) => {
        const weekReservations = weekReservationsMap.get(weekIndex) || []

        return (
          <div key={weekIndex} className="relative grid grid-cols-7">
            {/* Day cells */}
            {weekDays.map((day, dayIndex) => {
              const isWeekend = day.getDay() === 0 || day.getDay() === 6
              const inCurrentMonth = isCurrentMonth(day)
              const today = isToday(day)
              const overflow = getOverflowCount(filteredReservations, day, weekReservations)

              return (
                <div
                  key={dayIndex}
                  className={cn(
                    'relative border-b border-r last:border-r-0',
                    isWeekend && 'bg-muted/10',
                    !inCurrentMonth && 'bg-muted/30',
                    today && 'bg-primary/5'
                  )}
                  style={{ minHeight: MIN_DAY_HEIGHT }}
                >
                  {/* Day Number */}
                  <div className="flex items-center justify-between p-1.5">
                    <span
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full text-sm',
                        today
                          ? 'bg-primary font-semibold text-primary-foreground'
                          : !inCurrentMonth
                            ? 'text-muted-foreground/50'
                            : 'font-medium'
                      )}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {/* Overflow indicator */}
                  {overflow > 0 && (
                    <Link
                      href={`/dashboard/reservations?date=${day.toISOString().split('T')[0]}`}
                      className={cn(
                        'absolute bottom-1 left-1 right-1 text-center text-xs text-muted-foreground hover:text-foreground',
                        !inCurrentMonth && 'opacity-50'
                      )}
                    >
                      +{overflow} {t('moreItems', { count: overflow })}
                    </Link>
                  )}

                  {/* Today indicator line */}
                  {today && (
                    <div className="absolute bottom-1 left-1 right-1">
                      <div className="h-0.5 rounded-full bg-primary/50" />
                    </div>
                  )}
                </div>
              )
            })}

            {/* Spanning reservation bars - rendered on top of the week */}
            {weekReservations.map((wr) => (
              <SpanningReservationBar
                key={`${weekIndex}-${wr.reservation.id}`}
                weekReservation={wr}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}
