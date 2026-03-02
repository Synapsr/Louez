'use client';

import { useEffect, useState, useTransition } from 'react';

import { enUS, fr } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  Button,
  Calendar,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui';

import {
  createSeasonalPricing,
  updateSeasonalPricing,
} from '../seasonal-actions';
import type {
  PriceDurationValue,
  RateTierInput,
  SeasonalPricingData,
} from '../types';

interface SeasonalPeriodFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  editingData?: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
  } | null;
  /** Base pricing to pre-fill when creating a new period */
  basePriceDuration: PriceDurationValue | undefined;
  baseRateTiers: RateTierInput[];
  /** Called after a new period is created */
  onCreated: (newPeriod: SeasonalPricingData) => void;
  /** Called after an existing period's metadata is updated */
  onUpdated: (
    id: string,
    name: string,
    startDate: string,
    endDate: string,
  ) => void;
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a Date to a locale-aware input string (dd/mm/yyyy or mm/dd/yyyy) */
function formatDateForInput(d: Date, loc: string): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return loc === 'fr' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
}

/** Parse a locale-aware date string back to a Date */
function parseDateFromInput(text: string, loc: string): Date | undefined {
  const parts = text.trim().split('/');
  if (parts.length !== 3) return undefined;
  const [a, b, c] = parts.map(Number);
  if (!a || !b || !c || c < 1900 || c > 2100) return undefined;
  // fr: dd/mm/yyyy, en: mm/dd/yyyy
  const [day, month, year] = loc === 'fr' ? [a, b, c] : [b, a, c];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(year, month - 1, day);
  // Validate the date is real (e.g. not Feb 30)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  )
    return undefined;
  return d;
}

export function SeasonalPeriodFormDialog({
  open,
  onOpenChange,
  productId,
  editingData,
  basePriceDuration,
  baseRateTiers,
  onCreated,
  onUpdated,
}: SeasonalPeriodFormDialogProps) {
  const t = useTranslations('dashboard.products.form');
  const locale = useLocale();
  const calendarLocale = locale === 'fr' ? fr : enUS;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editingData;

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [startDateText, setStartDateText] = useState('');
  const [endDateText, setEndDateText] = useState('');

  const datePlaceholder = locale === 'fr' ? 'jj/mm/aaaa' : 'mm/dd/yyyy';
  const calendarStartMonth = new Date(new Date().getFullYear(), 0);
  const calendarEndMonth = new Date(new Date().getFullYear() + 10, 11);

  // Reset form when opening
  useEffect(() => {
    if (!open) return;

    if (editingData) {
      setName(editingData.name);
      const sd = new Date(editingData.startDate + 'T00:00:00');
      const ed = new Date(editingData.endDate + 'T00:00:00');
      setStartDate(sd);
      setEndDate(ed);
      setStartDateText(formatDateForInput(sd, locale));
      setEndDateText(formatDateForInput(ed, locale));
    } else {
      setName('');
      setStartDate(undefined);
      setEndDate(undefined);
      setStartDateText('');
      setEndDateText('');
    }
    setError(null);
  }, [open, editingData, locale]);

  const handleSave = () => {
    if (!name.trim() || !startDate || !endDate) {
      setError(t('seasonFieldsRequired'));
      return;
    }

    const startStr = formatDateStr(startDate);
    const endStr = formatDateStr(endDate);

    if (startStr >= endStr) {
      setError(t('seasonDateError'));
      return;
    }

    startTransition(async () => {
      setError(null);

      if (isEditing && editingData) {
        // For editing metadata, we call onUpdated which will handle the server action
        // with the current pricing data included
        onUpdated(editingData.id, name.trim(), startStr, endStr);
        onOpenChange(false);
      } else {
        // Creating: pre-fill with base pricing
        const basePrice = basePriceDuration?.price?.replace(',', '.') || '0';
        const payload = {
          productId,
          name: name.trim(),
          startDate: startStr,
          endDate: endStr,
          price: basePrice,
          rateTiers: baseRateTiers.map((tier) => ({
            price: tier.price.replace(',', '.'),
            duration: tier.duration,
            unit: tier.unit,
          })),
        };

        const result = await createSeasonalPricing(payload);

        if (result && 'error' in result) {
          setError(t(result.error as any) || result.error || null);
          return;
        }

        if (result && 'id' in result) {
          // Build the SeasonalPricingData to return
          const newPeriod: SeasonalPricingData = {
            id: result.id,
            name: name.trim(),
            startDate: startStr,
            endDate: endStr,
            price: basePrice,
            tiers: baseRateTiers.map((tier, index) => ({
              id: '',
              period:
                tier.duration *
                (tier.unit === 'week'
                  ? 10080
                  : tier.unit === 'day'
                    ? 1440
                    : tier.unit === 'hour'
                      ? 60
                      : 1),
              price: tier.price.replace(',', '.'),
              minDuration: null,
              discountPercent: null,
              displayOrder: index,
            })),
          };
          onCreated(newPeriod);
          onOpenChange(false);
        }
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('editPeriodTitle') : t('createPeriodTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('seasonalPeriodDescription')}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label>{t('seasonName')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('seasonNamePlaceholder')}
                disabled={isPending}
              />
            </div>

            {/* Date range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('seasonStartDate')}</Label>
                <div className="relative">
                  <Input
                    value={startDateText}
                    onChange={(e) => setStartDateText(e.target.value)}
                    onBlur={() => {
                      const parsed = parseDateFromInput(startDateText, locale);
                      if (parsed) {
                        setStartDate(parsed);
                      } else if (startDate) {
                        setStartDateText(formatDateForInput(startDate, locale));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const parsed = parseDateFromInput(
                          startDateText,
                          locale,
                        );
                        if (parsed) setStartDate(parsed);
                      }
                    }}
                    placeholder={datePlaceholder}
                    disabled={isPending}
                    className="pr-10"
                  />
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                          disabled={isPending}
                        />
                      }
                    >
                      <CalendarIcon className="h-4 w-4" />
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-auto overflow-hidden p-0 **:data-[slot=popover-viewport]:py-0"
                      align="start"
                    >
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={(d) => {
                          setStartDate(d);
                          if (d)
                            setStartDateText(formatDateForInput(d, locale));
                        }}
                        locale={calendarLocale}
                        captionLayout="dropdown"
                        startMonth={calendarStartMonth}
                        endMonth={calendarEndMonth}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('seasonEndDate')}</Label>
                <div className="relative">
                  <Input
                    value={endDateText}
                    onChange={(e) => setEndDateText(e.target.value)}
                    onBlur={() => {
                      const parsed = parseDateFromInput(endDateText, locale);
                      if (parsed) {
                        setEndDate(parsed);
                      } else if (endDate) {
                        setEndDateText(formatDateForInput(endDate, locale));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const parsed = parseDateFromInput(endDateText, locale);
                        if (parsed) setEndDate(parsed);
                      }
                    }}
                    placeholder={datePlaceholder}
                    disabled={isPending}
                    className="pr-10"
                  />
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                          disabled={isPending}
                        />
                      }
                    >
                      <CalendarIcon className="h-4 w-4" />
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-auto overflow-hidden p-0 **:data-[slot=popover-viewport]:py-0"
                      align="start"
                    >
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={(d) => {
                          setEndDate(d);
                          if (d) setEndDateText(formatDateForInput(d, locale));
                        }}
                        disabled={(date) =>
                          startDate ? date <= startDate : false
                        }
                        locale={calendarLocale}
                        captionLayout="dropdown"
                        startMonth={calendarStartMonth}
                        endMonth={calendarEndMonth}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-destructive text-sm font-medium">{error}</p>
            )}
          </div>
        </DialogPanel>

        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending
              ? t('saving')
              : isEditing
                ? t('saveChanges')
                : t('addSeasonalPeriod')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
