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
  Input,
  Label,
  Textarea,
  toastManager,
} from '@louez/ui';
import { toDatePickerValue } from '@louez/utils';

import { DatePicker } from '@/components/ui/date-time-picker';

import { updateUnitDetails } from '../actions';
import type { InventoryUnitRow } from '../queries';
import { getTranslatedActionError } from './util.inventory-format';

interface EditUnitDetailsDialogProps {
  open: boolean;
  unit: InventoryUnitRow | null;
  onOpenChange: (open: boolean) => void;
}

export const EditUnitDetailsDialog = ({
  open,
  unit,
  onOpenChange,
}: EditUnitDetailsDialogProps) => {
  const t = useTranslations('dashboard.inventory.editDialog');
  const tReservationForm = useTranslations('dashboard.reservations.manualForm');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchasedAt, setPurchasedAt] = useState<Date | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !unit) {
      return;
    }

    setNotes(unit.notes ?? '');
    setPurchasePrice(unit.purchasePrice ?? '');
    setPurchasedAt(toDatePickerValue(unit.purchasedAt));
    setIsSubmitting(false);
  }, [open, unit]);

  const handleSubmit = async () => {
    if (!unit) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await updateUnitDetails({
        unitId: unit.id,
        notes,
        purchasePrice: purchasePrice || null,
        purchasedAt: purchasedAt ?? null,
      });

      if ('error' in result && result.error) {
        toastManager.add({
          title: getTranslatedActionError(result.error, tErrors),
          type: 'error',
        });
        return;
      }

      toastManager.add({ title: t('successToast'), type: 'success' });
      router.refresh();
      onOpenChange(false);
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {unit ? t('description', { identifier: unit.identifier }) : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="unit-notes">{t('notes')}</Label>
              <Textarea
                id="unit-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t('notesPlaceholder')}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="unit-purchase-price">
                  {t('purchasePrice')}
                </Label>
                <Input
                  id="unit-purchase-price"
                  inputMode="decimal"
                  value={purchasePrice}
                  onChange={(event) => setPurchasePrice(event.target.value)}
                  placeholder={t('purchasePricePlaceholder')}
                />
              </div>
              <div className="grid gap-2">
                <Label>{t('purchasedAt')}</Label>
                <DatePicker
                  date={purchasedAt}
                  setDate={setPurchasedAt}
                  placeholder={tReservationForm('pickDate')}
                />
              </div>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {t('cancel')}
          </DialogClose>
          <Button onClick={handleSubmit} disabled={isSubmitting || !unit}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
