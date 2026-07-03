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
  Trash2,
  Unlink,
  Wrench,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  Badge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetTitle,
  toastManager,
} from '@louez/ui';

import { formatDateTime, formatRelativeTime } from '@/lib/utils';

import { loadUnitDowntimes, loadUnitTimeline } from '../actions';
import type {
  InventoryUnitRow,
  UnitDowntimeEntry,
  UnitTimelineEntry,
} from '../queries';

interface UnitHistorySheetProps {
  open: boolean;
  unit: InventoryUnitRow | null;
  onOpenChange: (open: boolean) => void;
}

const EVENT_ICONS = {
  created: CheckCircle2,
  deleted: Trash2,
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
  const tDowntime = useTranslations('dashboard.inventory.downtime');
  const tReasons = useTranslations('dashboard.inventory.downtimeReasons');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const [timeline, setTimeline] = useState<UnitTimelineEntry[]>([]);
  const [downtimes, setDowntimes] = useState<UnitDowntimeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!open || !unit) {
      return;
    }

    let isCurrent = true;
    setIsLoading(true);
    setTimeline([]);
    setDowntimes([]);

    Promise.all([
      loadUnitTimeline({ unitId: unit.id }),
      loadUnitDowntimes({ unitId: unit.id }),
    ])
      .then(([timelineResult, downtimesResult]) => {
        if (!isCurrent) {
          return;
        }

        if (!timelineResult.success || !downtimesResult.success) {
          toastManager.add({ title: tErrors('generic'), type: 'error' });
          return;
        }

        setTimeline(timelineResult.timeline);
        setDowntimes(downtimesResult.downtimes);
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

  const hasNoHistory =
    !isLoading && timeline.length === 0 && downtimes.length === 0;

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

          {hasNoHistory ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <History className="text-muted-foreground mx-auto h-8 w-8" />
              <p className="mt-2 text-sm font-medium">{t('empty')}</p>
            </div>
          ) : null}

          <div className="space-y-6">
            {!hasNoHistory ? (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">
                  {t('downtimes.title')}
                </h3>
                {!isLoading && downtimes.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {t('downtimes.empty')}
                  </p>
                ) : null}
                <div className="space-y-3">
                  {downtimes.map((downtime) => (
                    <div
                      key={downtime.id}
                      className="rounded-lg border p-3 text-sm"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium">
                            {tReasons(downtime.reason)}
                          </p>
                          <p className="text-muted-foreground">
                            {formatDateTime(downtime.startsAt)} →{' '}
                            {downtime.endsAt
                              ? formatDateTime(downtime.endsAt)
                              : tDowntime('openEnded')}
                          </p>
                        </div>
                        <Badge variant="outline" className="w-fit">
                          {t(`downtimes.status.${downtime.status}`)}
                        </Badge>
                      </div>
                      {downtime.note ? (
                        <p className="text-muted-foreground mt-2">
                          {downtime.note}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
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
          </div>
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
};
