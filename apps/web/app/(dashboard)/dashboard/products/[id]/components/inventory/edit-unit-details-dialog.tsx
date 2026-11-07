'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useMutation } from '@tanstack/react-query';
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
import { orpc } from '@/lib/orpc/react';

import type { ProductInventoryUnit } from '../../queries';
import { getApiErrorMessage } from './util.inventory-format';

interface EditUnitDetailsDialogProps {
  open: boolean;
  unit: ProductInventoryUnit | null;
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
  const updateMutation = useMutation(
    orpc.dashboard.products.updateUnitDetails.mutationOptions(),
  );
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
      await updateMutation.mutateAsync({
        unitId: unit.id,
        notes,
        purchasePrice: purchasePrice.trim() || null,
        purchasedAt: purchasedAt ?? null,
      });

      toastManager.add({ title: t('successToast'), type: 'success' });
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      toastManager.add({
        title: getApiErrorMessage(error, tErrors),
        type: 'error',
      });
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
          <Button onClick={handleSubmit} isPending={isSubmitting} disabled={!unit}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
