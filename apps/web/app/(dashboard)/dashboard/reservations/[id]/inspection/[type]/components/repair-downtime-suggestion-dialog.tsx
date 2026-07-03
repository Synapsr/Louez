'use client';

import { useEffect, useMemo, useState } from 'react';

import Link from 'next/link';

import { AlertTriangle, Loader2, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Checkbox,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  toastManager,
} from '@louez/ui';

import { declareDowntime } from '@/app/(dashboard)/dashboard/inventory/actions';
import { getTranslatedActionError } from '@/app/(dashboard)/dashboard/inventory/components/util.inventory-format';

interface RepairDowntimeSuggestionUnit {
  id: string;
  identifier: string;
  productName: string;
}

interface RepairDowntimeSuggestionDialogProps {
  open: boolean;
  units: RepairDowntimeSuggestionUnit[];
  reservationNumber: string;
  onDone: () => void;
}

export const RepairDowntimeSuggestionDialog = ({
  open,
  units,
  reservationNumber,
  onDone,
}: RepairDowntimeSuggestionDialogProps) => {
  const t = useTranslations(
    'dashboard.settings.inspection.wizard.repairDowntime',
  );
  const tErrors = useTranslations('errors');
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(
    () => new Set(units.map((unit) => unit.id)),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictsDetected, setConflictsDetected] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedUnitIds(new Set(units.map((unit) => unit.id)));
    setIsSubmitting(false);
    setConflictsDetected(false);
  }, [open, units]);

  const selectedUnits = useMemo(
    () => units.filter((unit) => selectedUnitIds.has(unit.id)),
    [selectedUnitIds, units],
  );

  const handleCheckedChange = (unitId: string, checked: boolean) => {
    setSelectedUnitIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(unitId);
      } else {
        next.delete(unitId);
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selectedUnits.length === 0) {
      toastManager.add({ title: t('noneSelected'), type: 'warning' });
      return;
    }

    const startsAt = new Date();
    const note = t('note', { reservationNumber });
    const remainingUnitIds = new Set(selectedUnitIds);
    let hasConflicts = false;

    setIsSubmitting(true);

    try {
      for (const unit of selectedUnits) {
        const result = await declareDowntime({
          unitId: unit.id,
          reason: 'repair',
          startsAt,
          endsAt: null,
          note,
        });

        if (!result.success) {
          toastManager.add({
            title: result.error
              ? getTranslatedActionError(result.error, tErrors)
              : tErrors('generic'),
            type: 'error',
          });
          setSelectedUnitIds(remainingUnitIds);
          return;
        }

        remainingUnitIds.delete(unit.id);
        hasConflicts = hasConflicts || result.conflicts.length > 0;
      }

      toastManager.add({
        title: t('createdToast', { count: selectedUnits.length }),
        type: 'success',
      });

      if (hasConflicts) {
        setConflictsDetected(true);
        setSelectedUnitIds(new Set());
        toastManager.add({ title: t('conflictsToast'), type: 'warning' });
        return;
      }

      onDone();
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (units.length === 0) {
    return null;
  }

  const firstUnitIdentifier = units[0]?.identifier ?? '';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onDone();
        }
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="bg-muted/40 flex gap-3 rounded-lg border p-3">
              <Wrench className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm font-medium">
                {units.length === 1
                  ? t('singleQuestion', { identifier: firstUnitIdentifier })
                  : t('multipleQuestion', { count: units.length })}
              </p>
            </div>

            <div className="space-y-2">
              {units.map((unit) => (
                <label
                  key={unit.id}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                >
                  <Checkbox
                    checked={selectedUnitIds.has(unit.id)}
                    disabled={isSubmitting || conflictsDetected}
                    onCheckedChange={(checked) =>
                      handleCheckedChange(unit.id, checked === true)
                    }
                  />
                  <span className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium">
                      {unit.identifier}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {unit.productName}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {conflictsDetected ? (
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-1 text-sm">
                  <p>{t('conflictsDescription')}</p>
                  <Link
                    href="/dashboard/inventory"
                    className="text-primary font-medium hover:underline"
                  >
                    {t('openInventory')}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={isSubmitting}>
            {t('skip')}
          </Button>
          {conflictsDetected ? (
            <Button onClick={onDone}>{t('done')}</Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {t('submit')}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
