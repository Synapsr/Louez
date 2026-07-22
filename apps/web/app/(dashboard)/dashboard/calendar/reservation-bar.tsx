'use client';

import { forwardRef, useState } from 'react';
import type { MouseEvent } from 'react';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { Truck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Tooltip, TooltipContent, TooltipTrigger } from '@louez/ui';
import { cn, formatDateShort, formatTime } from '@louez/utils';

import {
  createDashboardReservationHref,
  createDashboardReturnTo,
} from '@/lib/dashboard/util.reservation-navigation';

import { ReservationLogisticsLocations } from './reservation-logistics-locations';
import type { Reservation, ReservationStatus } from './types';
import { getReservationLogisticsKind } from './util.reservation-logistics';

// =============================================================================
// Status Colors
// =============================================================================

const statusColors: Record<ReservationStatus, string> = {
  pending:
    'bg-reservation-pending-soft text-reservation-pending hover:brightness-[0.98]',
  confirmed:
    'bg-reservation-confirmed-soft text-reservation-confirmed hover:brightness-[0.98]',
  ongoing:
    'bg-reservation-ongoing-soft text-reservation-ongoing hover:brightness-[0.98]',
  completed:
    'bg-reservation-completed-soft text-reservation-completed hover:brightness-[0.98]',
  cancelled:
    'bg-reservation-cancelled-soft text-reservation-cancelled hover:brightness-[0.98]',
  rejected:
    'bg-reservation-rejected-soft text-reservation-rejected hover:brightness-[0.98]',
  quote:
    'bg-reservation-quote-soft text-reservation-quote hover:brightness-[0.98]',
  declined:
    'bg-reservation-declined-soft text-reservation-declined hover:brightness-[0.98]',
};

// =============================================================================
// Types
// =============================================================================

interface ReservationBarProps {
  reservation: Reservation;
  /** Whether the reservation continues before the visible range */
  continuesBefore?: boolean;
  /** Whether the reservation continues after the visible range */
  continuesAfter?: boolean;
  /** Show compact version (less details) */
  compact?: boolean;
  /** Show only the dot indicator without text */
  minimal?: boolean;
  /** Additional class names */
  className?: string;
  /** Custom style for positioning */
  style?: React.CSSProperties;
}

function formatReservationItems(items: Reservation['items']): string {
  const quantitiesByProduct = new Map<string, number>();

  for (const item of items) {
    const productName = item.productSnapshot?.name || item.product?.name;

    if (!productName) {
      continue;
    }

    const quantity = item.quantity > 0 ? item.quantity : 1;
    quantitiesByProduct.set(
      productName,
      (quantitiesByProduct.get(productName) ?? 0) + quantity,
    );
  }

  return Array.from(quantitiesByProduct.entries())
    .map(([productName, quantity]) =>
      quantity > 1 ? `${productName} ×${quantity}` : productName,
    )
    .join(', ');
}

function getReservationItemsList(
  items: Reservation['items'],
): { name: string; quantity: number }[] {
  const quantitiesByProduct = new Map<string, number>();

  for (const item of items) {
    const productName = item.productSnapshot?.name || item.product?.name;

    if (!productName) {
      continue;
    }

    const quantity = item.quantity > 0 ? item.quantity : 1;
    quantitiesByProduct.set(
      productName,
      (quantitiesByProduct.get(productName) ?? 0) + quantity,
    );
  }

  return Array.from(quantitiesByProduct.entries()).map(([name, quantity]) => ({
    name,
    quantity,
  }));
}

const statusDotColors: Record<ReservationStatus, string> = {
  pending: 'bg-reservation-pending',
  confirmed: 'bg-reservation-confirmed',
  ongoing: 'bg-reservation-ongoing',
  completed: 'bg-reservation-completed',
  cancelled: 'bg-reservation-cancelled',
  rejected: 'bg-reservation-rejected',
  quote: 'bg-reservation-quote',
  declined: 'bg-reservation-declined',
};

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
export const ReservationBar = forwardRef<
  HTMLAnchorElement,
  ReservationBarProps
>(function ReservationBar(
  {
    reservation,
    continuesBefore = false,
    continuesAfter = false,
    compact = false,
    minimal = false,
    className,
    style,
  },
  ref,
) {
  const t = useTranslations('dashboard.calendar');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = reservation.status || 'pending';
  const logisticsKind = getReservationLogisticsKind(reservation);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const logisticsLabel = logisticsKind
    ? t(`logistics.${logisticsKind}`)
    : null;
  const reservationHref = createDashboardReservationHref({
    reservationId: reservation.id,
    returnTo: createDashboardReturnTo(pathname, searchParams),
  });

  const customerName = `${reservation.customer.firstName} ${reservation.customer.lastName}`;
  const productNames = formatReservationItems(reservation.items);
  const handleReservationClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      logisticsKind &&
      window.matchMedia('(pointer: coarse)').matches
    ) {
      event.preventDefault();
      setTooltipOpen(true);
    }
  };

  // Minimal mode: just a colored dot
  if (minimal) {
    return (
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger
          render={
            <Link
              ref={ref}
              href={reservationHref}
              onClick={handleReservationClick}
              className={cn(
                'block h-2 w-2 rounded-full transition-transform hover:scale-125',
                className,
              )}
              style={style}
            />
          }
        />

        <TooltipContent side="top" className="max-w-xs">
          <ReservationTooltipContent
            reservation={reservation}
            customerName={customerName}
            statusLabel={t(`status.${status}`)}
            reservationHref={reservationHref}
          />
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
      <TooltipTrigger
        delay={75}
        render={
          <Link
            ref={ref}
            href={reservationHref}
            onClick={handleReservationClick}
            className={cn(
              'group relative block overflow-hidden transition-all',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
              statusColors[status],
              // Base styling
              compact ? 'h-6 text-xs' : 'h-7 text-xs',
              'px-2 py-1',
              // Border radius based on continuation
              continuesBefore && continuesAfter
                ? 'rounded-none'
                : continuesBefore
                  ? 'rounded-l-none rounded-r-md'
                  : continuesAfter
                    ? 'rounded-l-md rounded-r-none'
                    : 'rounded-md',
              // Shadow
              className,
            )}
            style={style}
          />
        }
      >
        {/* Continuation indicator (left) */}
        {continuesBefore && (
          <span
            className="absolute top-1/2 left-0 -translate-y-1/2 text-current/60"
            aria-hidden="true"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
            </svg>
          </span>
        )}

        {/* Content */}
        <div
          className={cn(
            'flex h-full items-center',
            continuesBefore && 'pl-2',
            continuesAfter && 'pr-2',
          )}
        >
          {logisticsLabel && (
            <span
              className="bg-warning/20 text-warning-foreground dark:text-warning mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
              title={logisticsLabel}
            >
              <Truck className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{logisticsLabel}</span>
            </span>
          )}
          <span className="truncate font-medium">{customerName}</span>
          {!compact && productNames && (
            <span className="ml-1 hidden truncate opacity-80 sm:inline">
              - {productNames}
            </span>
          )}
        </div>

        {/* Continuation indicator (right) */}
        {continuesAfter && (
          <span
            className="absolute top-1/2 right-0 -translate-y-1/2 text-current/60"
            aria-hidden="true"
          >
            <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
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
          reservationHref={reservationHref}
        />
      </TooltipContent>
    </Tooltip>
  );
});

// =============================================================================
// Tooltip Content
// =============================================================================

interface TooltipContentProps {
  reservation: Reservation;
  customerName: string;
  statusLabel: string;
  reservationHref: string;
}

function ReservationTooltipContent({
  reservation,
  customerName,
  statusLabel,
  reservationHref,
}: TooltipContentProps) {
  const status = reservation.status || 'pending';
  const items = getReservationItemsList(reservation.items);
  const t = useTranslations('dashboard.calendar');
  const logisticsKind = getReservationLogisticsKind(reservation);

  return (
    <div className="min-w-48 space-y-2 p-1.5">
      {/* Header: name + status badge */}
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-semibold">{customerName}</span>
        <span className="bg-muted mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              statusDotColors[status],
            )}
          />
          {statusLabel}
        </span>
      </div>

      {logisticsKind && (
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Truck
            className="text-warning h-3.5 w-3.5"
            aria-hidden="true"
          />
          <span>{t(`logistics.${logisticsKind}`)}</span>
        </div>
      )}

      <ReservationLogisticsLocations reservation={reservation} />

      {/* Products list */}
      {items.length > 0 && (
        <ul className="text-muted-foreground space-y-0.5 text-xs">
          {items.map((item) => (
            <li key={item.name} className="flex items-baseline gap-1.5">
              <span className="text-muted-foreground/50 shrink-0">-</span>
              <span>{item.name}</span>
              {item.quantity > 1 && (
                <span className="text-muted-foreground text-[10px] font-semibold">
                  x{item.quantity}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Footer: ref + dates */}
      <div className="text-muted-foreground space-y-1 border-t pt-1.5 text-[11px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground/70">Départ</span>
          <span>
            {formatDateShort(reservation.startDate)}{' '}
            <span className="tabular-nums">
              {formatTime(reservation.startDate)}
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground/70">Arrivée</span>
          <span>
            {formatDateShort(reservation.endDate)}{' '}
            <span className="tabular-nums">
              {formatTime(reservation.endDate)}
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <span className="font-mono">#{reservation.number}</span>
        </div>
      </div>

      <Link
        href={reservationHref}
        className="text-primary inline-flex text-xs font-medium underline-offset-2 hover:underline"
      >
        {t('viewReservation')}
      </Link>
    </div>
  );
}
