'use client'

import { forwardRef } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { cn, formatDateShort } from '@louez/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@louez/ui'
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
  quote: 'bg-violet-500 hover:bg-violet-600',
  declined: 'bg-slate-400 hover:bg-slate-500',
}

const statusColorsDark: Record<ReservationStatus, string> = {
  pending: 'dark:bg-yellow-600 dark:hover:bg-yellow-700',
  confirmed: 'dark:bg-green-600 dark:hover:bg-green-700',
  ongoing: 'dark:bg-blue-600 dark:hover:bg-blue-700',
  completed: 'dark:bg-gray-500 dark:hover:bg-gray-600',
  cancelled: 'dark:bg-red-400 dark:hover:bg-red-500',
  rejected: 'dark:bg-red-500 dark:hover:bg-red-600',
  quote: 'dark:bg-violet-600 dark:hover:bg-violet-700',
  declined: 'dark:bg-slate-500 dark:hover:bg-slate-600',
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

function formatReservationItems(items: Reservation['items']): string {
  const quantitiesByProduct = new Map<string, number>()

  for (const item of items) {
    const productName = item.productSnapshot?.name || item.product?.name

    if (!productName) {
      continue
    }

    const quantity = item.quantity > 0 ? item.quantity : 1
    quantitiesByProduct.set(
      productName,
      (quantitiesByProduct.get(productName) ?? 0) + quantity
    )
  }

  return Array.from(quantitiesByProduct.entries())
    .map(([productName, quantity]) =>
      quantity > 1 ? `${productName} ×${quantity}` : productName
    )
    .join(', ')
}

function getReservationItemsList(items: Reservation['items']): { name: string; quantity: number }[] {
  const quantitiesByProduct = new Map<string, number>()

  for (const item of items) {
    const productName = item.productSnapshot?.name || item.product?.name

    if (!productName) {
      continue
    }

    const quantity = item.quantity > 0 ? item.quantity : 1
    quantitiesByProduct.set(
      productName,
      (quantitiesByProduct.get(productName) ?? 0) + quantity
    )
  }

  return Array.from(quantitiesByProduct.entries()).map(([name, quantity]) => ({ name, quantity }))
}

const statusDotColors: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-500',
  confirmed: 'bg-green-500',
  ongoing: 'bg-blue-500',
  completed: 'bg-gray-400',
  cancelled: 'bg-red-300',
  rejected: 'bg-red-400',
  quote: 'bg-violet-500',
  declined: 'bg-slate-400',
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
    const productNames = formatReservationItems(reservation.items)

    // Minimal mode: just a colored dot
    if (minimal) {
      return (
        <Tooltip>
          <TooltipTrigger render={<Link
              ref={ref}
              href={`/dashboard/reservations/${reservation.id}`}
              className={cn(
                'block h-2 w-2 rounded-full transition-transform hover:scale-125',
                statusColors[status],
                statusColorsDark[status],
                className
              )}
              style={style}
            />} />

          <TooltipContent side="top" className="max-w-xs">
            <ReservationTooltipContent
              reservation={reservation}
              customerName={customerName}
              statusLabel={t(`status.${status}`)}
            />
          </TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger render={<Link
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
          />}>
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
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <ReservationTooltipContent
            reservation={reservation}
            customerName={customerName}
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
  statusLabel: string
}

function ReservationTooltipContent({
  reservation,
  customerName,
  statusLabel,
}: TooltipContentProps) {
  const status = reservation.status || 'pending'
  const items = getReservationItemsList(reservation.items)

  return (
    <div className="min-w-48 space-y-2 p-1.5">
      {/* Header: name + status badge */}
      <div className="flex items-start justify-between gap-3">
        <span className="font-semibold text-sm">{customerName}</span>
        <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap bg-muted">
          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', statusDotColors[status])} />
          {statusLabel}
        </span>
      </div>

      {/* Products list */}
      {items.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {items.map((item) => (
            <li key={item.name} className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-muted-foreground/50">-</span>
              <span>{item.name}</span>
              {item.quantity > 1 && (
                <span className="text-[10px] font-semibold text-muted-foreground">x{item.quantity}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Footer: ref + dates */}
      <div className="flex items-center justify-between gap-3 border-t pt-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">#{reservation.number}</span>
        <span>
          {formatDateShort(reservation.startDate)} - {formatDateShort(reservation.endDate)}
        </span>
      </div>
    </div>
  )
}
