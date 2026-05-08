'use client';

import { useCallback, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AlertCircle, Calendar, CalendarX2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { StoreSettings } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { Switch } from '@louez/ui';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui';
import { Alert, AlertDescription } from '@louez/ui';
import { Badge } from '@louez/ui';
import { Textarea } from '@louez/ui';
import { normalizeDaySchedule } from '@louez/utils';
import {
  type BusinessHoursInput,
  businessHoursSchema,
  defaultBusinessHours,
} from '@louez/validations';

import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar';
import { ReservationDatePickerControl } from '@/components/form/form-reservation-date-picker';
import { RootError } from '@/components/form/root-error';

import {
  DAY_KEYS,
  buildStoreDate,
  generateTimeSlots,
} from '@/lib/utils/business-hours';
import { formatStoreDate } from '@/lib/utils/store-date';

import { useAppForm } from '@/hooks/form/form';

import { updateBusinessHours } from './actions';

const MAX_RANGES_PER_DAY = 4;

interface Store {
  id: string;
  settings: StoreSettings | null;
}

interface BusinessHoursFormProps {
  store: Store;
}

export function BusinessHoursForm({ store }: BusinessHoursFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [closureDialogOpen, setClosureDialogOpen] = useState(false);
  const t = useTranslations('dashboard.settings.businessHours');
  const tCommon = useTranslations('common');

  // Normalize legacy format: stores that still have { openTime, closeTime }
  // at the day level (instead of ranges[]) need conversion for the form.
  const rawBusinessHours =
    store.settings?.businessHours || defaultBusinessHours;
  const businessHours = {
    ...rawBusinessHours,
    schedule: Object.fromEntries(
      Object.entries(rawBusinessHours.schedule).map(([key, value]) => [
        key,
        normalizeDaySchedule(value as unknown as Record<string, unknown>),
      ]),
    ),
  } as BusinessHoursInput;

  const [rootError, setRootError] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: businessHours,
    validators: { onSubmit: businessHoursSchema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      startTransition(async () => {
        const result = await updateBusinessHours(value);
        if (result.error) {
          setRootError(result.error);
          return;
        }
        toastManager.add({ title: t('saved'), type: 'success' });
        // Update the form baseline so isDirty becomes false
        form.options.defaultValues = value;
        form.reset();
        router.refresh();
      });
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);

  const handleReset = useCallback(() => {
    form.reset();
  }, [form]);

  const isEnabled = useStore(form.store, (s) => s.values.enabled);

  const timeSlots = generateTimeSlots('00:00', '23:30', 30);
  const timezone = store.settings?.timezone;

  const addClosurePeriod = (data: {
    name: string;
    startDate: string;
    endDate: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }) => {
    form.pushFieldValue('closurePeriods', {
      id: crypto.randomUUID(),
      ...data,
    });
    setClosureDialogOpen(false);
  };

  const removeClosurePeriod = (index: number) => {
    form.removeFieldValue('closurePeriods', index);
  };

  const closurePeriods = useStore(form.store, (s) => s.values.closurePeriods);

  return (
    <div className="min-w-0 space-y-6">
      <form.AppForm>
        <form.Form className="min-w-0 space-y-6">
          <RootError error={rootError} />

          {/* Two-column layout on desktop */}
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr),minmax(300px,400px)] lg:items-start">
            {/* Weekly Schedule - Left column */}
            <Card className="min-w-0">
              <CardHeader>
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <CardTitle>{t('weeklySchedule')}</CardTitle>
                    <CardDescription>
                      {t('weeklyScheduleDescription')}
                    </CardDescription>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground hidden text-sm sm:inline">
                      {isEnabled ? t('enabled') : t('disabled')}
                    </span>
                    <form.Field name="enabled">
                      {(field) => (
                        <Switch
                          checked={field.state.value}
                          onCheckedChange={(checked) =>
                            field.handleChange(checked)
                          }
                        />
                      )}
                    </form.Field>
                  </div>
                </div>
              </CardHeader>
              <CardContent
                className={`min-w-0 ${!isEnabled ? 'pointer-events-none opacity-50' : ''}`}
              >
                <div className="min-w-0 divide-y">
                  {DAY_KEYS.map((dayKey) => (
                    <DayScheduleRow
                      key={dayKey}
                      dayKey={dayKey}
                      form={form}
                      t={t}
                      timeSlots={timeSlots}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Closure Periods - Right column */}
            <Card className="min-w-0">
              <CardHeader>
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <CardTitle>{t('closurePeriods')}</CardTitle>
                    <CardDescription>
                      {t('closurePeriodsDescription')}
                    </CardDescription>
                  </div>
                  <div className="shrink-0">
                    <ClosurePeriodDialog
                      open={closureDialogOpen}
                      onOpenChange={setClosureDialogOpen}
                      onAdd={addClosurePeriod}
                      t={t}
                      tCommon={tCommon}
                      timezone={timezone}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="min-w-0">
                {closurePeriods.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="bg-muted mb-3 rounded-full p-3">
                      <CalendarX2 className="text-muted-foreground h-5 w-5" />
                    </div>
                    <p className="text-muted-foreground text-sm font-medium">
                      {t('noClosure')}
                    </p>
                    <p className="text-muted-foreground mt-1 max-w-[220px] text-xs">
                      {t('noClosureDescription')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {closurePeriods.map((field, index) => (
                      <div
                        key={field.id}
                        className="flex items-center justify-between gap-2 rounded-lg border p-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Calendar className="text-muted-foreground h-4 w-4 shrink-0" />
                            <span className="truncate text-sm font-medium">
                              {field.name}
                            </span>
                          </div>
                          <p className="text-muted-foreground text-xs">
                            {format(new Date(field.startDate), 'dd MMM yyyy', {
                              locale: fr,
                            })}
                            {' - '}
                            {format(new Date(field.endDate), 'dd MMM yyyy', {
                              locale: fr,
                            })}
                            {field.startTime && field.endTime && (
                              <>
                                {' · '}
                                {field.startTime}
                                {' - '}
                                {field.endTime}
                              </>
                            )}
                          </p>
                          {field.reason && (
                            <p className="text-muted-foreground truncate text-xs">
                              {field.reason}
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => removeClosurePeriod(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <FloatingSaveBar
            isDirty={isDirty}
            isLoading={isPending}
            onReset={handleReset}
          />
        </form.Form>
      </form.AppForm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day Schedule Row - supports multiple time ranges per day
// ---------------------------------------------------------------------------
function DayScheduleRow({
  dayKey,
  form,
  t,
  timeSlots,
}: {
  dayKey: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  form: any;
  t: ReturnType<typeof useTranslations>;
  timeSlots: string[];
}) {
  const schedule = useStore(form.store, (s: any) => s.values.schedule);
  const daySchedule = schedule[dayKey];
  const isOpen = daySchedule?.isOpen ?? false;
  const ranges = daySchedule?.ranges ?? [
    { openTime: '09:00', closeTime: '18:00' },
  ];

  const addRange = () => {
    if (ranges.length >= MAX_RANGES_PER_DAY) return;

    // Compute a sensible default: start 1h after last close, end 2h later.
    // Clamp to valid hours and ensure open < close.
    const lastRange = ranges[ranges.length - 1];
    const [lastHour] = lastRange.closeTime.split(':').map(Number);
    const openHour = Math.min(lastHour + 1, 22);
    const closeHour = Math.min(openHour + 2, 23);

    form.pushFieldValue(`schedule.${dayKey}.ranges`, {
      openTime: `${openHour.toString().padStart(2, '0')}:00`,
      closeTime: `${closeHour.toString().padStart(2, '0')}:00`,
    });
  };

  const removeRange = (index: number) => {
    if (ranges.length <= 1) return;
    form.removeFieldValue(`schedule.${dayKey}.ranges`, index);
  };

  return (
    <div className="px-1 py-3">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3 sm:w-32 sm:shrink-0">
          <form.Field name={`schedule.${dayKey}.isOpen` as any}>
            {(field: any) => (
              <Switch
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
            )}
          </form.Field>
          <span
            className={`min-w-0 truncate text-sm font-medium ${!isOpen ? 'text-muted-foreground' : ''}`}
          >
            {t(`days.${dayKey}`)}
          </span>
        </div>

        {isOpen ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {ranges.map(
              (
                _range: { openTime: string; closeTime: string },
                rangeIndex: number,
              ) => (
                <div
                  key={rangeIndex}
                  className="flex min-w-0 items-center gap-2"
                >
                  <form.Field
                    name={
                      `schedule.${dayKey}.ranges[${rangeIndex}].openTime` as any
                    }
                  >
                    {(field: any) => (
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => {
                          if (value !== null) field.handleChange(value);
                        }}
                      >
                        <SelectTrigger className="min-w-0 flex-1 sm:w-[100px] sm:flex-none">
                          <SelectValue>{field.state.value}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {timeSlots.map((time) => (
                            <SelectItem key={time} value={time} label={time}>
                              {time}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </form.Field>
                  <span className="text-muted-foreground shrink-0 text-sm">
                    -
                  </span>
                  <form.Field
                    name={
                      `schedule.${dayKey}.ranges[${rangeIndex}].closeTime` as any
                    }
                  >
                    {(field: any) => (
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => {
                          if (value !== null) field.handleChange(value);
                        }}
                      >
                        <SelectTrigger className="min-w-0 flex-1 sm:w-[100px] sm:flex-none">
                          <SelectValue>{field.state.value}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {timeSlots.map((time) => (
                            <SelectItem key={time} value={time} label={time}>
                              {time}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </form.Field>
                  {ranges.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
                      onClick={() => removeRange(rangeIndex)}
                      aria-label={t('removeRange')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ),
            )}
            {ranges.length < MAX_RANGES_PER_DAY && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground h-7 self-start text-xs"
                onClick={addRange}
              >
                <Plus className="mr-1 h-3 w-3" />
                {t('addRange')}
              </Button>
            )}
          </div>
        ) : (
          <Badge variant="secondary" className="text-muted-foreground w-fit">
            {t('closed')}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Closure Period Dialog
// ---------------------------------------------------------------------------
function ClosurePeriodDialog({
  open,
  onOpenChange,
  onAdd,
  t,
  tCommon,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (data: {
    name: string;
    startDate: string;
    endDate: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }) => void;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
  timezone?: string;
}) {
  const tValidation = useTranslations('validation');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const getClosureDateValue = (date: string, time: string) => {
    if (!date) return undefined;

    return buildStoreDate(
      new Date(`${date}T00:00:00`),
      time || '00:00',
      timezone,
    );
  };

  const handleStartDateChange = (date: Date | undefined) => {
    if (!date) {
      setStartDate('');
      setStartTime('');
      return;
    }

    setStartDate(formatStoreDate(date, timezone, 'yyyy-MM-dd'));
    setStartTime(formatStoreDate(date, timezone, 'TIME_ONLY'));
  };

  const handleEndDateChange = (date: Date | undefined) => {
    if (!date) {
      setEndDate('');
      setEndTime('');
      return;
    }

    setEndDate(formatStoreDate(date, timezone, 'yyyy-MM-dd'));
    setEndTime(formatStoreDate(date, timezone, 'TIME_ONLY'));
  };

  const handleSubmit = () => {
    if (!name || !startDate || !endDate) {
      setError(tValidation('requiredFields'));
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      setError(tValidation('endDateBeforeStart'));
      return;
    }

    if ((startTime && !endTime) || (!startTime && endTime)) {
      setError(t('closureForm.timeRangeRequired'));
      return;
    }

    if (startTime && endTime && startTime >= endTime) {
      setError(t('validation.closeAfterOpen'));
      return;
    }

    onAdd({
      name,
      startDate,
      endDate,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      reason: reason || undefined,
    });

    // Reset form
    setName('');
    setStartDate('');
    setEndDate('');
    setStartTime('');
    setEndTime('');
    setReason('');
    setError('');
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setName('');
      setStartDate('');
      setEndDate('');
      setStartTime('');
      setEndTime('');
      setReason('');
      setError('');
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <Plus className="mr-2 h-4 w-4" />
        {t('addClosure')}
      </DialogTrigger>
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('closureForm.title')}</DialogTitle>
          <DialogDescription>
            {t('closurePeriodsDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-3">
          {error && (
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('closureForm.name')} *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('closureForm.namePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ReservationDatePickerControl
              id="closure-start-date"
              value={getClosureDateValue(startDate, startTime)}
              onChange={handleStartDateChange}
              label={`${t('closureForm.startDate')} *`}
              minTime="00:00"
              maxTime="23:59"
              timeStep={30}
              defaultTime="00:00"
              timezone={timezone}
            />
            <ReservationDatePickerControl
              id="closure-end-date"
              value={getClosureDateValue(endDate, endTime)}
              onChange={handleEndDateChange}
              label={`${t('closureForm.endDate')} *`}
              minTime="00:00"
              maxTime="23:59"
              timeStep={30}
              defaultTime="23:30"
              referenceDate={getClosureDateValue(startDate, startTime)}
              disabledDates={(date) => {
                const start = getClosureDateValue(startDate, startTime);
                if (!start) return false;

                const startDay = new Date(start);
                startDay.setHours(0, 0, 0, 0);
                return date < startDay;
              }}
              timezone={timezone}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              {t('closureForm.reason')}
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('closureForm.reasonPlaceholder')}
              rows={2}
            />
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {t('closureForm.add')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
