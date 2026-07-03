'use client';

import Link from 'next/link';

import {
  Archive,
  History,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui';

import type { InventoryUnitRow } from '../queries';

interface InventoryRowActionsProps {
  row: InventoryUnitRow;
  disabled?: boolean;
  onCloseDowntime: (row: InventoryUnitRow) => void;
  onDeclareDowntime: (row: InventoryUnitRow) => void;
  onEditDetails: (row: InventoryUnitRow) => void;
  onReinstate: (row: InventoryUnitRow) => void;
  onRetire: (row: InventoryUnitRow) => void;
  onViewHistory: (row: InventoryUnitRow) => void;
}

export const InventoryRowActions = ({
  row,
  disabled = false,
  onCloseDowntime,
  onDeclareDowntime,
  onEditDetails,
  onReinstate,
  onRetire,
  onViewHistory,
}: InventoryRowActionsProps) => {
  const t = useTranslations('dashboard.inventory.actions');
  const tCommon = useTranslations('common');
  const isRetired = row.lifecycleStatus === 'retired';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" disabled={disabled} />}
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">{tCommon('actions')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onDeclareDowntime(row)}>
          {row.currentDowntime ? (
            <>
              <Pencil className="mr-2 h-4 w-4" />
              {t('editDowntime')}
            </>
          ) : (
            <>
              <Wrench className="mr-2 h-4 w-4" />
              {t('declareDowntime')}
            </>
          )}
        </DropdownMenuItem>
        {row.currentDowntime ? (
          <DropdownMenuItem onClick={() => onCloseDowntime(row)}>
            <XCircle className="mr-2 h-4 w-4" />
            {t('closeDowntime')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {isRetired ? (
          <DropdownMenuItem onClick={() => onReinstate(row)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('reinstate')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onRetire(row)}>
            <Archive className="mr-2 h-4 w-4" />
            {t('retire')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onEditDetails(row)}>
          <Pencil className="mr-2 h-4 w-4" />
          {t('editDetails')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onViewHistory(row)}>
          <History className="mr-2 h-4 w-4" />
          {t('viewHistory')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href={`/dashboard/products/${row.productId}`} />}
        >
          <Pencil className="mr-2 h-4 w-4" />
          {t('editProduct')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
