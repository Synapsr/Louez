'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  Switch,
  Textarea,
  toastManager,
} from '@louez/ui';

import { ReservationDatePickerControl } from '@/components/form/form-reservation-date-picker';
import { invalidateProductInventory } from '@/lib/orpc/invalidation';
import { orpc } from '@/lib/orpc/react';

import type { ProductInventoryUnit } from '../../queries';
import { ConflictsPanel } from './conflicts-panel';
import {
  DOWNTIME_REASON_OPTIONS,
  type DowntimeReasonOption,
  isDowntimeReasonOption,
} from './inventory.constants';
import type { InventoryConflict } from './unit-types';
import { getApiErrorMessage } from './util.inventory-format';

interface DowntimeDialogProps {
  open: boolean;
  unit: ProductInventoryUnit | null;
  onOpenChange: (open: boolean) => void;
}

export const DowntimeDialog = ({
  open,
  unit,
  onOpenChange,
}: DowntimeDialogProps) => {
  const t = useTranslations('dashboard.inventory.downtimeDialog');
  const tReasons = useTranslations('dashboard.inventory.downtimeReasons');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const declareMutation = useMutation(
    orpc.dashboard.products.declareDowntime.mutationOptions(),
  );
  const updateMutation = useMutation(
    orpc.dashboard.products.updateDowntime.mutationOptions(),
  );
  const [reason, setReason] = useState<DowntimeReasonOption>('maintenance');
  const [startsAt, setStartsAt] = useState<Date | undefined>(() => new Date());
  const [endsAt, setEndsAt] = useState<Date | undefined>();
  const [openEnded, setOpenEnded] = useState(true);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<InventoryConflict[]>([]);
  const currentDowntime = unit?.currentDowntime ?? null;
  const isEditing = Boolean(currentDowntime);

  useEffect(() => {
    if (!open) {
      return;
    }

    setReason(currentDowntime?.reason ?? 'maintenance');
    setStartsAt(currentDowntime?.startsAt ?? new Date());
    setEndsAt(currentDowntime?.endsAt ?? undefined);
    setOpenEnded(currentDowntime?.endsAt == null);
    setNote(currentDowntime?.note ?? '');
    setIsSubmitting(false);
    setConflicts([]);
  }, [currentDowntime, open, unit?.id]);

  const handleSubmit = async () => {
    if (!unit) {
      return;
    }

    if (
      !startsAt ||
      Number.isNaN(startsAt.getTime()) ||
      (!openEnded && endsAt && Number.isNaN(endsAt.getTime()))
    ) {
      toastManager.add({ title: tErrors('invalidData'), type: 'error' });
      return;
    }

    const endsAtDate = openEnded ? null : (endsAt ?? null);

    setIsSubmitting(true);
    try {
      const result = currentDowntime
        ? await updateMutation.mutateAsync({
            downtimeId: currentDowntime.id,
            reason,
            startsAt,
            endsAt: endsAtDate,
            note,
          })
        : await declareMutation.mutateAsync({
            unitId: unit.id,
            reason,
            startsAt,
            endsAt: endsAtDate,
            note,
          });

      toastManager.add({
        title: t(isEditing ? 'editSuccessToast' : 'successToast'),
        type: 'success',
      });
      await invalidateProductInventory(queryClient);
      router.refresh();

      if (result.conflicts.length > 0) {
        setConflicts(result.conflicts);
        return;
      }

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
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(isEditing ? 'editTitle' : 'title')}</DialogTitle>
          <DialogDescription>
            {unit ? t('description', { identifier: unit.identifier }) : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>{t('reason')}</Label>
              <Select
                value={reason}
                onValueChange={(value) => {
                  if (value && isDowntimeReasonOption(value)) {
                    setReason(value);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue>{tReasons(reason)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DOWNTIME_REASON_OPTIONS.map((option) => (
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

            <div className="grid gap-3 sm:grid-cols-2">
              <ReservationDatePickerControl
                id="downtime-starts-at"
                label={t('startsAt')}
                value={startsAt}
                onChange={setStartsAt}
                timeStep={30}
              />
              <ReservationDatePickerControl
                id="downtime-ends-at"
                label={t('endsAt')}
                value={endsAt}
                onChange={setEndsAt}
                timeStep={30}
                referenceDate={startsAt}
                disabled={openEnded}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="downtime-open-ended">{t('openEnded')}</Label>
              <Switch
                id="downtime-open-ended"
                checked={openEnded}
                onCheckedChange={setOpenEnded}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="downtime-note">{t('note')}</Label>
              <Textarea
                id="downtime-note"
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
          <Button onClick={handleSubmit} isPending={isSubmitting} disabled={!unit}>
            {t(isEditing ? 'editSubmit' : 'submit')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
