'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { parseAsStringLiteral, useQueryState } from 'nuqs';

import { CalendarRange, List } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  ToggleGroup,
  ToggleGroupItem,
} from '@louez/ui';
import type { StockKind } from '@louez/types';

import {
  ReservationConfirmDialogs,
  useReservationActions,
} from '@/app/(dashboard)/dashboard/reservations/reservations-actions';
import { ReservationsCardView } from '@/app/(dashboard)/dashboard/reservations/reservations-card-view';
import type {
  Reservation,
  ReservationStatus,
} from '@/app/(dashboard)/dashboard/reservations/reservations-types';
import { EmptyState } from '@/components/ui/empty-state';

import { ProductReservationsTimeline } from './reservations-timeline/product-reservations-timeline';

type ViewMode = 'list' | 'calendar';

interface ProductReservationsSectionBodyProps {
  reservationsPage: { items: Reservation[]; total: number };
  currency: string;
  timezone?: string;
  productId: string;
  trackUnits: boolean;
  stockKind: StockKind;
  units: { id: string; identifier: string }[];
  quantity: number;
}

export function ProductReservationsSectionBody({
  reservationsPage,
  currency,
  timezone,
  productId,
  trackUnits,
  stockKind,
  units,
  quantity,
}: ProductReservationsSectionBodyProps) {
  const t = useTranslations('dashboard.products.detail.reservations');
  const router = useRouter();

  // View mode is URL-persisted (`resaView`) so timeline links are shareable.
  const [viewMode, setViewMode] = useQueryState(
    'resaView',
    parseAsStringLiteral(['list', 'calendar'] as const)
      .withDefault('calendar')
      .withOptions({ history: 'replace' }),
  );

  const handleViewModeChange = (value: string[]) => {
    const selected = value[0];
    if (!selected) return;
    void setViewMode(selected as ViewMode);
  };

  // Shared quick actions (accept / reject / picked up / returned) from the
  // reservations page. The list here is server-rendered, so refresh after
  // each mutation to reflect the new status.
  const {
    loadingAction,
    handleStatusChange,
    openRejectDialog,
    confirmDialogsProps,
  } = useReservationActions();

  const handleStatusChangeAndRefresh = async (
    e: React.MouseEvent,
    reservation: Reservation,
    newStatus: ReservationStatus,
  ) => {
    await handleStatusChange(e, reservation, newStatus);
    router.refresh();
  };

  const handleRejectAndRefresh = async () => {
    await confirmDialogsProps.handleReject();
    router.refresh();
  };

  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-4 w-4" />
          {t('title')}
        </CardTitle>
        <CardAction>
          <ToggleGroup value={[viewMode]} onValueChange={handleViewModeChange}>
            <ToggleGroupItem value="list" aria-label={t('viewList')}>
              <List className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="calendar" aria-label={t('viewCalendar')}>
              <CalendarRange className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {viewMode === 'calendar' ? (
          <ProductReservationsTimeline
            productId={productId}
            currency={currency}
            trackUnits={trackUnits}
            stockKind={stockKind}
            units={units}
            quantity={quantity}
          />
        ) : reservationsPage.items.length === 0 ? (
          <EmptyState icon={CalendarRange} title={t('empty')} />
        ) : (
          <>
            <ReservationsCardView
              reservations={reservationsPage.items}
              currency={currency}
              timezone={timezone}
              loadingAction={loadingAction}
              handleStatusChange={handleStatusChangeAndRefresh}
              openRejectDialog={openRejectDialog}
            />
            <ReservationConfirmDialogs
              {...confirmDialogsProps}
              handleReject={handleRejectAndRefresh}
            />
            {reservationsPage.total > reservationsPage.items.length && (
              <p className="text-muted-foreground mt-3 text-center text-xs">
                {t('viewAllHint', { total: reservationsPage.total })}{' '}
                <Link href="/dashboard/reservations" className="underline">
                  {t('viewAllLink')}
                </Link>
              </p>
            )}
          </>
        )}
      </CardContent>
    </>
  );
}
