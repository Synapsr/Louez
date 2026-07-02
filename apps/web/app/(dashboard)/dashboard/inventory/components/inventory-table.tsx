'use client';

import { useState } from 'react';

import { useRouter, useSearchParams } from 'next/navigation';

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toastManager,
} from '@louez/ui';

import { closeDowntime, reinstateUnit } from '../actions';
import type { InventoryRow, InventoryUnitRow } from '../queries';
import { BulkProductTableRow } from './bulk-product-table-row';
import { DowntimeCell } from './downtime-cell';
import { DowntimeDialog } from './downtime-dialog';
import { EditUnitDetailsDialog } from './edit-unit-details-dialog';
import { IndicatorsCell } from './indicators-cell';
import { InventoryRowActions } from './inventory-row-actions';
import { InventoryStateBadge } from './inventory-state-badge';
import { ProductCell } from './product-cell';
import { RetireDialog } from './retire-dialog';
import { UnitHistorySheet } from './unit-history-sheet';
import {
  formatPurchaseInfo,
  getTranslatedActionError,
} from './util.inventory-format';

interface InventoryTableProps {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageSize: number;
  currency?: string;
}

export const InventoryTable = ({
  rows,
  total,
  page,
  pageSize,
  currency = 'EUR',
}: InventoryTableProps) => {
  const t = useTranslations('dashboard.inventory');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedDowntimeUnit, setSelectedDowntimeUnit] =
    useState<InventoryUnitRow | null>(null);
  const [selectedRetireUnit, setSelectedRetireUnit] =
    useState<InventoryUnitRow | null>(null);
  const [selectedEditUnit, setSelectedEditUnit] =
    useState<InventoryUnitRow | null>(null);
  const [selectedHistoryUnit, setSelectedHistoryUnit] =
    useState<InventoryUnitRow | null>(null);
  const [pendingUnitId, setPendingUnitId] = useState<string | null>(null);

  const handleCloseDowntime = async (row: InventoryUnitRow) => {
    if (!row.currentDowntime) {
      return;
    }

    setPendingUnitId(row.id);
    try {
      const result = await closeDowntime({
        downtimeId: row.currentDowntime.id,
      });

      if ('error' in result && result.error) {
        toastManager.add({
          title: getTranslatedActionError(result.error, tErrors),
          type: 'error',
        });
        return;
      }

      toastManager.add({
        title: t('toasts.downtimeClosed'),
        type: 'success',
      });
      router.refresh();
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setPendingUnitId(null);
    }
  };

  const handleReinstate = async (row: InventoryUnitRow) => {
    setPendingUnitId(row.id);
    try {
      const result = await reinstateUnit({ unitId: row.id });

      if ('error' in result && result.error) {
        toastManager.add({
          title: getTranslatedActionError(result.error, tErrors),
          type: 'error',
        });
        return;
      }

      toastManager.add({ title: t('toasts.reinstated'), type: 'success' });
      router.refresh();
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setPendingUnitId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pushPage = (targetPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (targetPage <= 1) {
      params.delete('page');
    } else {
      params.set('page', targetPage.toString());
    }

    const queryString = params.toString();
    const href = queryString
      ? `/dashboard/inventory?${queryString}`
      : '/dashboard/inventory';
    router.push(href);
  };

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('table.identifier')}</TableHead>
              <TableHead>{t('table.product')}</TableHead>
              <TableHead>{t('table.state')}</TableHead>
              <TableHead>{t('table.downtime')}</TableHead>
              <TableHead className="text-center">{t('table.notes')}</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) =>
              row.kind === 'unit' ? (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{row.identifier}</span>
                      {pendingUnitId === row.id ? (
                        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                      ) : null}
                    </div>
                    {row.purchasePrice || row.purchasedAt ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {formatPurchaseInfo(row, currency)}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <ProductCell row={row} />
                  </TableCell>
                  <TableCell>
                    <InventoryStateBadge state={row.state} />
                  </TableCell>
                  <TableCell>
                    <DowntimeCell
                      currentDowntime={row.currentDowntime}
                      nextDowntime={row.nextDowntime}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <IndicatorsCell row={row} />
                  </TableCell>
                  <TableCell>
                    <InventoryRowActions
                      row={row}
                      disabled={pendingUnitId === row.id}
                      onCloseDowntime={handleCloseDowntime}
                      onDeclareDowntime={setSelectedDowntimeUnit}
                      onEditDetails={setSelectedEditUnit}
                      onReinstate={handleReinstate}
                      onRetire={setSelectedRetireUnit}
                      onViewHistory={setSelectedHistoryUnit}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                <BulkProductTableRow key={row.productId} row={row} />
              ),
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => pushPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            {t('pagination.previous')}
          </Button>
          <span className="text-muted-foreground text-sm">
            {t('pagination.page', { page, totalPages })}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => pushPage(page + 1)}
          >
            {t('pagination.next')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <DowntimeDialog
        open={Boolean(selectedDowntimeUnit)}
        unit={selectedDowntimeUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDowntimeUnit(null);
          }
        }}
      />
      <RetireDialog
        open={Boolean(selectedRetireUnit)}
        unit={selectedRetireUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRetireUnit(null);
          }
        }}
      />
      <EditUnitDetailsDialog
        open={Boolean(selectedEditUnit)}
        unit={selectedEditUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEditUnit(null);
          }
        }}
      />
      <UnitHistorySheet
        open={Boolean(selectedHistoryUnit)}
        unit={selectedHistoryUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedHistoryUnit(null);
          }
        }}
      />
    </>
  );
};
