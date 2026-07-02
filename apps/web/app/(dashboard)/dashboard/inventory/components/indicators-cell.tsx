'use client';

import { AlertTriangle, StickyNote } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui';

import type { InventoryUnitRow } from '../queries';

interface IndicatorsCellProps {
  row: InventoryUnitRow;
}

export const IndicatorsCell = ({ row }: IndicatorsCellProps) => {
  const t = useTranslations('dashboard.inventory.indicators');

  return (
    <TooltipProvider>
      <div className="flex justify-center gap-1">
        {row.hasConflicts ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-amber-600" />
              }
            >
              <AlertTriangle className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>{t('conflicts')}</TooltipContent>
          </Tooltip>
        ) : null}
        {row.notes ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="text-muted-foreground inline-flex h-8 w-8 items-center justify-center rounded-md" />
              }
            >
              <StickyNote className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>{t('notes')}</TooltipContent>
          </Tooltip>
        ) : null}
        {!row.hasConflicts && !row.notes ? (
          <span className="text-muted-foreground text-sm">-</span>
        ) : null}
      </div>
    </TooltipProvider>
  );
};
