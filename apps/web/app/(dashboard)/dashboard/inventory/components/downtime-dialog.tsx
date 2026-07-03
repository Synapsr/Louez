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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toastManager,
} from '@louez/ui';

import { declareDowntime, updateDowntime } from '../actions';
import type { InventoryUnitRow } from '../queries';
import { ConflictsPanel } from './conflicts-panel';
import type { InventoryConflict } from './inventory-types';
import {
  DOWNTIME_REASON_OPTIONS,
  type DowntimeReasonOption,
  isDowntimeReasonOption,
} from './inventory.constants';
import {
  getTranslatedActionError,
  parseOptionalDate,
  toDateTimeLocalInputValue,
} from './util.inventory-format';

interface DowntimeDialogProps {
  open: boolean;
  unit: InventoryUnitRow | null;
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
  const [reason, setReason] = useState<DowntimeReasonOption>('maintenance');
  const [startsAt, setStartsAt] = useState(
    toDateTimeLocalInputValue(new Date()),
  );
  const [endsAt, setEndsAt] = useState('');
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
    setStartsAt(
      toDateTimeLocalInputValue(currentDowntime?.startsAt ?? new Date()),
    );
    setEndsAt(toDateTimeLocalInputValue(currentDowntime?.endsAt ?? null));
    setOpenEnded(currentDowntime?.endsAt == null);
    setNote(currentDowntime?.note ?? '');
    setIsSubmitting(false);
    setConflicts([]);
  }, [currentDowntime, open, unit?.id]);

  const handleSubmit = async () => {
    if (!unit) {
      return;
    }

    const startsAtDate = parseOptionalDate(startsAt);
    const endsAtDate = openEnded ? null : parseOptionalDate(endsAt);

    if (!startsAtDate || (!openEnded && !endsAtDate)) {
      toastManager.add({ title: tErrors('invalidData'), type: 'error' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = currentDowntime
        ? await updateDowntime({
            downtimeId: currentDowntime.id,
            reason,
            startsAt: startsAtDate,
            endsAt: endsAtDate,
            note,
          })
        : await declareDowntime({
            unitId: unit.id,
            reason,
            startsAt: startsAtDate,
            endsAt: endsAtDate,
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

      toastManager.add({
        title: t(isEditing ? 'editSuccessToast' : 'successToast'),
        type: 'success',
      });
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
              <div className="grid gap-2">
                <Label htmlFor="downtime-starts-at">{t('startsAt')}</Label>
                <Input
                  id="downtime-starts-at"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="downtime-ends-at">{t('endsAt')}</Label>
                <Input
                  id="downtime-ends-at"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  disabled={openEnded}
                />
              </div>
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
          <Button onClick={handleSubmit} disabled={isSubmitting || !unit}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t(isEditing ? 'editSubmit' : 'submit')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
