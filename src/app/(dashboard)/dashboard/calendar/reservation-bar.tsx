'use client'

import { forwardRef } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { cn, formatDateShort } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Reservation, ReservationStatus } from './types'

// =============================================================================
// Status Colors
// =============================================================================

const statusColors: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-500 hover:bg-yellow-600',
  confirmed: 'bg-green-500 hover:bg-green-600',
  ongoing: 'bg-blue-500 hover:bg-blue-600',
  completed: 'bg-gray-400 hover:bg-gray-500',
  cancelled: 'bg-red-300 hover:bg-red-400',
  rejected: 'bg-red-400 hover:bg-red-500',
}

const statusColorsDark: Record<ReservationStatus, string> = {
  pending: 'dark:bg-yellow-600 dark:hover:bg-yellow-700',
  confirmed: 'dark:bg-green-600 dark:hover:bg-green-700',
  ongoing: 'dark:bg-blue-600 dark:hover:bg-blue-700',
  completed: 'dark:bg-gray-500 dark:hover:bg-gray-600',
  cancelled: 'dark:bg-red-400 dark:hover:bg-red-500',
  rejected: 'dark:bg-red-500 dark:hover:bg-red-600',
}

// =============================================================================
// Types
// =============================================================================

interface ReservationBarProps {
  reservation: Reservation
  /** Whether the reservation continues before the visible range */
  continuesBefore?: boolean
  /** Whether the reservation continues after the visible range */
  continuesAfter?: boolean
  /** Show compact version (less details) */
  compact?: boolean
  /** Show only the dot indicator without text */
  minimal?: boolean
  /** Additional class names */
  className?: string
  /** Custom style for positioning */
  style?: React.CSSProperties
}

// =============================================================================
// Component
// =============================================================================

/**
 * ReservationBar component
 *
 * Displays a reservation as a styled bar with customer info and status.
 * Supports different display modes:
 * - Full: Shows customer name and product details
 * - Compact: Shows only customer name
 * - Minimal: Shows only a colored dot
 *
 * The bar handles continuation indicators for multi-day reservations
 * that extend beyond the visible range.
 */
export const ReservationBar = forwardRef<HTMLAnchorElement, ReservationBarProps>(
  function ReservationBar(
    {
      reservation,
      continuesBefore = false,
      continuesAfter = false,
      compact = false,
      minimal = false,
      className,
      style,
    },
    ref
  ) {
    const t = useTranslations('dashboard.calendar')
    const status = reservation.status || 'pending'

    const customerName = `${reservation.customer.firstName} ${reservation.customer.lastName}`
    const productNames = reservation.items
      .map((item) => item.productSnapshot?.name || item.product?.name)
      .filter(Boolean)
      .join(', ')

    // Minimal mode: just a colored dot
    if (minimal) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              ref={ref}
              href={`/dashboard/reservations/${reservation.id}`}
              className={cn(
                'block h-2 w-2 rounded-full transition-transform hover:scale-125',
                statusColors[status],
                statusColorsDark[status],
                className
              )}
              style={style}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <ReservationTooltipContent
              reservation={reservation}
              customerName={customerName}
              productNames={productNames}
              statusLabel={t(`status.${status}`)}
            />
          </TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            ref={ref}
            href={`/dashboard/reservations/${reservation.id}`}
            className={cn(
              'group relative block overflow-hidden text-white transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              statusColors[status],
              statusColorsDark[status],
              // Base styling
              compact ? 'h-6 text-xs' : 'h-7 text-xs',
              'px-2 py-1',
              // Border radius based on continuation
              continuesBefore && continuesAfter
                ? 'rounded-none'
                : continuesBefore
                  ? 'rounded-r-md rounded-l-none'
                  : continuesAfter
                    ? 'rounded-l-md rounded-r-none'
                    : 'rounded-md',
              // Shadow
              'shadow-sm',
              className
            )}
            style={style}
          >
            {/* Continuation indicator (left) */}
            {continuesBefore && (
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 text-white/60"
                aria-hidden="true"
              >
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
                </svg>
              </span>
            )}

            {/* Content */}
            <div
              className={cn(
                'flex h-full items-center',
                continuesBefore && 'pl-2',
                continuesAfter && 'pr-2'
              )}
            >
              <span className="truncate font-medium">{customerName}</span>
              {!compact && productNames && (
                <span className="ml-1 hidden truncate text-white/80 sm:inline">
                  - {productNames}
                </span>
              )}
            </div>

            {/* Continuation indicator (right) */}
            {continuesAfter && (
              <span
                className="absolute right-0 top-1/2 -translate-y-1/2 text-white/60"
                aria-hidden="true"
              >
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <ReservationTooltipContent
            reservation={reservation}
            customerName={customerName}
            productNames={productNames}
            statusLabel={t(`status.${status}`)}
          />
        </TooltipContent>
      </Tooltip>
    )
  }
)

// =============================================================================
// Tooltip Content
// =============================================================================

interface TooltipContentProps {
  reservation: Reservation
  customerName: string
  productNames: string
  statusLabel: string
}

function ReservationTooltipContent({
  reservation,
  customerName,
  productNames,
  statusLabel,
}: TooltipContentProps) {
  return (
    <div className="space-y-1.5 text-sm">
      <div className="font-semibold">{customerName}</div>
      {productNames && (
        <div className="text-muted-foreground">{productNames}</div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>#{reservation.number}</span>
        <span>-</span>
        <span>{statusLabel}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {formatDateShort(reservation.startDate)} -{' '}
        {formatDateShort(reservation.endDate)}
      </div>
    </div>
  )
}
