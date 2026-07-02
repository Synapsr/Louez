'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import {
  Archive,
  CheckCircle2,
  Clock,
  History,
  Link2,
  Loader2,
  Pencil,
  RotateCcw,
  Unlink,
  Wrench,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
  toastManager,
} from '@louez/ui';

import { formatDateTime, formatRelativeTime } from '@/lib/utils';

import { loadUnitTimeline } from '../actions';
import type { InventoryUnitRow, UnitTimelineEntry } from '../queries';

interface UnitHistorySheetProps {
  open: boolean;
  unit: InventoryUnitRow | null;
  onOpenChange: (open: boolean) => void;
}

const EVENT_ICONS = {
  created: CheckCircle2,
  downtime_declared: Wrench,
  downtime_updated: Wrench,
  downtime_closed: Wrench,
  downtime_deleted: Wrench,
  retired: Archive,
  reinstated: RotateCcw,
  assigned: Link2,
  unassigned: Unlink,
  updated: Pencil,
} satisfies Record<
  Extract<UnitTimelineEntry, { kind: 'event' }>['type'],
  typeof History
>;

export const UnitHistorySheet = ({
  open,
  unit,
  onOpenChange,
}: UnitHistorySheetProps) => {
  const t = useTranslations('dashboard.inventory.history');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const [timeline, setTimeline] = useState<UnitTimelineEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open || !unit) {
      return;
    }

    let isCurrent = true;
    setIsLoading(true);
    setTimeline([]);

    loadUnitTimeline({ unitId: unit.id })
      .then((result) => {
        if (!isCurrent) {
          return;
        }

        if (!result.success) {
          toastManager.add({ title: tErrors('generic'), type: 'error' });
          return;
        }

        setTimeline(result.timeline);
      })
      .catch(() => {
        if (isCurrent) {
          toastManager.add({ title: tErrors('generic'), type: 'error' });
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [open, tErrors, unit]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>
            {unit ? t('description', { identifier: unit.identifier }) : ''}
          </SheetDescription>
        </SheetHeader>
        <SheetPanel>
          {isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('loading')}
            </div>
          ) : null}

          {!isLoading && timeline.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <History className="text-muted-foreground mx-auto h-8 w-8" />
              <p className="mt-2 text-sm font-medium">{t('empty')}</p>
            </div>
          ) : null}

          <div className="space-y-4">
            {timeline.map((entry) => {
              const Icon =
                entry.kind === 'event' ? EVENT_ICONS[entry.type] : Link2;
              const label =
                entry.kind === 'event'
                  ? t(`events.${entry.type}`)
                  : t('events.assignment', {
                      number: entry.reservationNumber,
                    });
              const actor =
                entry.kind === 'event'
                  ? (entry.actorName ?? t('systemActor'))
                  : (entry.customerName ?? t('unknownCustomer'));

              return (
                <div key={`${entry.kind}-${entry.id}`} className="flex gap-3">
                  <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-medium">{label}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatRelativeTime(entry.createdAt, locale)}
                      </p>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      {t('byActor', { actor })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      <Clock className="mr-1 inline h-3 w-3" />
                      {formatDateTime(entry.createdAt)}
                    </p>
                    {entry.kind === 'assignment' ? (
                      <Link
                        href={`/dashboard/reservations/${entry.reservationId}`}
                        className="text-primary text-sm hover:underline"
                      >
                        {t('viewReservation')}
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
};
