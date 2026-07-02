'use client';

import { useTranslations } from 'next-intl';

import { formatDateTime } from '@/lib/utils';

import type { InventoryDowntimeSummary } from '../queries';

interface DowntimeCellProps {
  currentDowntime: InventoryDowntimeSummary | null;
  nextDowntime: InventoryDowntimeSummary | null;
}

export const DowntimeCell = ({
  currentDowntime,
  nextDowntime,
}: DowntimeCellProps) => {
  const t = useTranslations('dashboard.inventory');
  const tReasons = useTranslations('dashboard.inventory.downtimeReasons');

  if (currentDowntime) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {t('downtime.current', {
            reason: tReasons(currentDowntime.reason),
          })}
        </p>
        <p className="text-muted-foreground text-xs">
          {currentDowntime.endsAt
            ? t('downtime.until', {
                date: formatDateTime(currentDowntime.endsAt),
              })
            : t('downtime.openEnded')}
        </p>
      </div>
    );
  }

  if (nextDowntime) {
    return (
      <div className="space-y-1">
        <p className="text-sm">
          {t('downtime.next', {
            reason: tReasons(nextDowntime.reason),
          })}
        </p>
        <p className="text-muted-foreground text-xs">
          {formatDateTime(nextDowntime.startsAt)}
        </p>
      </div>
    );
  }

  return (
    <span className="text-muted-foreground text-sm">{t('downtime.none')}</span>
  );
};
