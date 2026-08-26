'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { Loader2, Package } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toastManager,
} from '@louez/ui';
import type { UnitAttributes } from '@louez/types';

import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/utils';
import { useFormatLocale } from '@/hooks/use-format-locale';

import { closeDowntime, reinstateUnit } from '../actions';
import type { ProductInventoryUnit } from '../queries';
import { DowntimeDialog } from './inventory/downtime-dialog';
import { EditUnitDetailsDialog } from './inventory/edit-unit-details-dialog';
import { IndicatorsCell } from './inventory/indicators-cell';
import { RetireDialog } from './inventory/retire-dialog';
import { UnitHistorySheet } from './inventory/unit-history-sheet';
import { UnitRowActions } from './inventory/unit-row-actions';
import {
  formatUnitAttributes,
  getTranslatedActionError,
} from './inventory/util.inventory-format';

interface ProductUnitsTableProps {
  units: ProductInventoryUnit[];
}

function isUnitAttributes(value: unknown): value is UnitAttributes {
  return typeof value === 'object' && value !== null;
}

export function ProductUnitsTable({ units }: ProductUnitsTableProps) {
  const { intl: formatLocale } = useFormatLocale();
  const t = useTranslations('dashboard.products.detail.inventory');
  const tInventory = useTranslations('dashboard.inventory');
  const tErrors = useTranslations('errors');
  const router = useRouter();

  const [pendingUnitId, setPendingUnitId] = useState<string | null>(null);
  const [selectedDowntimeUnit, setSelectedDowntimeUnit] =
    useState<ProductInventoryUnit | null>(null);
  const [selectedRetireUnit, setSelectedRetireUnit] =
    useState<ProductInventoryUnit | null>(null);
  const [selectedEditUnit, setSelectedEditUnit] =
    useState<ProductInventoryUnit | null>(null);
  const [selectedHistoryUnit, setSelectedHistoryUnit] =
    useState<ProductInventoryUnit | null>(null);

  const handleCloseDowntime = async (unit: ProductInventoryUnit) => {
    if (!unit.currentDowntime) {
      return;
    }

    setPendingUnitId(unit.id);
    try {
      const result = await closeDowntime({
        downtimeId: unit.currentDowntime.id,
      });

      if ('error' in result && result.error) {
        toastManager.add({
          title: getTranslatedActionError(result.error, tErrors),
          type: 'error',
        });
        return;
      }

      toastManager.add({
        title: tInventory('toasts.downtimeClosed'),
        type: 'success',
      });
      router.refresh();
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setPendingUnitId(null);
    }
  };

  const handleReinstate = async (unit: ProductInventoryUnit) => {
    setPendingUnitId(unit.id);
    try {
      const result = await reinstateUnit({ unitId: unit.id });

      if ('error' in result && result.error) {
        toastManager.add({
          title: getTranslatedActionError(result.error, tErrors),
          type: 'error',
        });
        return;
      }

      toastManager.add({ title: tInventory('toasts.reinstated'), type: 'success' });
      router.refresh();
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setPendingUnitId(null);
    }
  };

  if (units.length === 0) {
    return <EmptyState icon={Package} title={t('noUnits')} />;
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('identifier')}</TableHead>
              <TableHead>{t('attributes')}</TableHead>
              <TableHead>{t('unitStatus')}</TableHead>
              <TableHead>{t('lifecycle')}</TableHead>
              <TableHead className="text-center">
                {tInventory('table.notes')}
              </TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((unit) => {
              const attributesLabel = formatUnitAttributes(
                isUnitAttributes(unit.attributes) ? unit.attributes : null,
              );
              const isRetired = unit.lifecycleStatus === 'retired';

              return (
                <TableRow key={unit.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{unit.identifier}</span>
                      {pendingUnitId === unit.id ? (
                        <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {attributesLabel || '—'}
                  </TableCell>
                  <TableCell>
                    {isRetired ? (
                      <span className="text-xs text-muted-foreground">
                        {unit.retirementReason
                          ? tInventory(
                              `retirementReasons.${unit.retirementReason}`,
                            )
                          : '—'}
                        {unit.retiredAt
                          ? ` · ${formatDate(unit.retiredAt, undefined, formatLocale)}`
                          : ''}
                      </span>
                    ) : unit.currentDowntime ? (
                      <Badge variant="pending">{t('inDowntime')}</Badge>
                    ) : unit.isBusyToday ? (
                      <Badge variant="progress">{t('busyToday')}</Badge>
                    ) : (
                      <Badge variant="success">{t('available')}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={isRetired ? 'expired' : 'success'}>
                      {isRetired ? t('retired') : t('active')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <IndicatorsCell row={unit} />
                  </TableCell>
                  <TableCell>
                    <UnitRowActions
                      row={unit}
                      disabled={pendingUnitId === unit.id}
                      onCloseDowntime={handleCloseDowntime}
                      onDeclareDowntime={setSelectedDowntimeUnit}
                      onEditDetails={setSelectedEditUnit}
                      onReinstate={handleReinstate}
                      onRetire={setSelectedRetireUnit}
                      onViewHistory={setSelectedHistoryUnit}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DowntimeDialog
        open={selectedDowntimeUnit !== null}
        unit={selectedDowntimeUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDowntimeUnit(null);
          }
        }}
      />
      <RetireDialog
        open={selectedRetireUnit !== null}
        unit={selectedRetireUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRetireUnit(null);
          }
        }}
      />
      <EditUnitDetailsDialog
        open={selectedEditUnit !== null}
        unit={selectedEditUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEditUnit(null);
          }
        }}
      />
      <UnitHistorySheet
        open={selectedHistoryUnit !== null}
        unit={selectedHistoryUnit}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedHistoryUnit(null);
          }
        }}
      />
    </>
  );
}
