'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toastManager,
} from '@louez/ui';

import { retireUnit } from '../actions';
import type { InventoryUnitRow } from '../queries';
import { ConflictsPanel } from './conflicts-panel';
import type { InventoryConflict } from './inventory-types';
import {
  RETIREMENT_REASON_OPTIONS,
  type RetirementReasonOption,
  isRetirementReasonOption,
} from './inventory.constants';
import { getTranslatedActionError } from './util.inventory-format';

interface RetireDialogProps {
  open: boolean;
  unit: InventoryUnitRow | null;
  onOpenChange: (open: boolean) => void;
}

export const RetireDialog = ({
  open,
  unit,
  onOpenChange,
}: RetireDialogProps) => {
  const t = useTranslations('dashboard.inventory.retireDialog');
  const tReasons = useTranslations('dashboard.inventory.retirementReasons');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const [reason, setReason] = useState<RetirementReasonOption>('broken');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<InventoryConflict[]>([]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setReason('broken');
    setNote('');
    setIsSubmitting(false);
    setConflicts([]);
  }, [open, unit?.id]);

  const handleSubmit = async () => {
    if (!unit) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await retireUnit({
        unitId: unit.id,
        reason,
        note,
      });

      if (!result.success) {
        toastManager.add({
          title: result.error
            ? getTranslatedActionError(result.error, tErrors)
            : tErrors('generic'),
          type: 'error',
        });
        return;
      }

      toastManager.add({ title: t('successToast'), type: 'success' });
      router.refresh();

      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        return;
      }

      onOpenChange(false);
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {unit ? t('description', { identifier: unit.identifier }) : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <p className="bg-muted/40 rounded-lg border p-3 text-sm">
              {t('confirmationCopy')}
            </p>

            <div className="grid gap-2">
              <Label>{t('reason')}</Label>
              <Select
                value={reason}
                onValueChange={(value) => {
                  if (value && isRetirementReasonOption(value)) {
                    setReason(value);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue>{tReasons(reason)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RETIREMENT_REASON_OPTIONS.map((option) => (
                    <SelectItem
                      key={option}
                      value={option}
                      label={tReasons(option)}
                    >
                      {tReasons(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="retirement-note">{t('note')}</Label>
              <Textarea
                id="retirement-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('notePlaceholder')}
              />
            </div>

            {unit && conflicts.length > 0 ? (
              <ConflictsPanel conflicts={conflicts} fromUnitId={unit.id} />
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {t('close')}
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isSubmitting || !unit}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
