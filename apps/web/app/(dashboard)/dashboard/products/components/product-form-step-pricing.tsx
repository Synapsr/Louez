'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { format } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import {
  CalendarRange,
  Check,
  Copy,
  Info,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Puzzle,
  Trash2,
} from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';

import type { PricingMode, Rate, TaxSettings } from '@louez/types';
import { minutesToPriceDuration, priceDurationToMinutes } from '@louez/utils';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  toastManager,
} from '@louez/ui';

import { AccessoriesSelector } from '@/components/dashboard/accessories-selector';
import {
  CHART_RANGE_PRESETS,
  type ChartRangePreset,
  buildChartData,
  buildChartTicks,
  PricingChart,
  RatesEditor,
  resolveChartMaxMinutes,
  SHOW_DEV_CHART_RANGE_SELECTOR,
} from '@/components/dashboard/rates-editor';
import { UnitTrackingEditor } from '@/components/dashboard/unit-tracking-editor';
import {
  PriceDurationInput,
  type PriceDurationValue,
} from '@/components/ui/price-duration-input';

import { getFieldError } from '@/hooks/form/form-context';

import type {
  AvailableAccessory,
  ProductFormComponentApi,
  ProductFormValues,
  RateTierInput,
  SeasonalPricingData,
} from '../types';
import {
  deleteSeasonalPricing,
  duplicateSeasonalPricing,
  updateSeasonalPricing,
} from '../seasonal-actions';

import { PricingPeriodSelector } from './pricing-period-selector';
import { SeasonalPeriodFormDialog } from './seasonal-period-form-dialog';

interface ProductFormStepPricingProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  currency: string;
  currencySymbol: string;
  isSaving: boolean;
  duplicateRateTierIndexes?: number[];
  onRateTiersEdit?: () => void;
  storeTaxSettings?: TaxSettings;
  availableAccessories: AvailableAccessory[];
  showAccessories: boolean;
  showStock?: boolean;
  showUnitValidationErrors?: boolean;
  // Seasonal pricing props (optional - only passed in edit mode)
  productId?: string;
  seasonalPricings?: SeasonalPricingData[];
  selectedSeasonalPeriodId?: string | null;
  onSelectSeasonalPeriod?: (id: string | null) => void;
  onSeasonalPricingsChange?: (pricings: SeasonalPricingData[]) => void;
  isLoadingSeasonalPricings?: boolean;
}

function toLegacyPricingMode(unit: PriceDurationValue['unit']): PricingMode {
  if (unit === 'week') return 'week';
  if (unit === 'day') return 'day';
  return 'hour';
}

function hasValidBaseRate(value: PriceDurationValue | undefined): boolean {
  if (!value) return false;
  if (value.duration < 1) return false;
  const normalizedPrice = value.price.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalizedPrice)) return false;
  return Number.parseFloat(normalizedPrice) > 0;
}

function toFormTiers(tiers: SeasonalPricingData['tiers']): RateTierInput[] {
  return tiers
    .filter((t) => t.period !== null && t.price !== null)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    .map((t) => {
      const { duration, unit } = minutesToPriceDuration(t.period!);
      return {
        id: t.id,
        price: t.price!,
        duration,
        unit,
      };
    });
}

export function ProductFormStepPricing({
  form,
  watchedValues,
  currency,
  currencySymbol,
  isSaving,
  duplicateRateTierIndexes = [],
  onRateTiersEdit,
  storeTaxSettings,
  availableAccessories,
  showAccessories,
  showStock = true,
  showUnitValidationErrors = false,
  // Seasonal props
  productId,
  seasonalPricings = [],
  selectedSeasonalPeriodId = null,
  onSelectSeasonalPeriod,
  onSeasonalPricingsChange,
  isLoadingSeasonalPricings = false,
}: ProductFormStepPricingProps) {
  const t = useTranslations('dashboard.products.form');
  const locale = useLocale();
  const calendarLocale = locale === 'fr' ? fr : enUS;
  const [highlightBaseRate, setHighlightBaseRate] = useState(false);

  // Seasonal inline editing state
  const [seasonalPriceDuration, setSeasonalPriceDuration] = useState<PriceDurationValue | undefined>();
  const [seasonalRateTiers, setSeasonalRateTiers] = useState<RateTierInput[]>([]);
  const [seasonalDirty, setSeasonalDirty] = useState(false);
  const [isSavingSeasonal, startSeasonalTransition] = useTransition();
  const [seasonalChartRangePreset, setSeasonalChartRangePreset] =
    useState<ChartRangePreset>('auto');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState<{
    id: string; name: string; startDate: string; endDate: string;
  } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Track the previous period id to detect changes and auto-save
  const isSeasonalMode = selectedSeasonalPeriodId !== null;
  const selectedPeriod = isSeasonalMode
    ? seasonalPricings.find((sp) => sp.id === selectedSeasonalPeriodId) ?? null
    : null;

  // Load seasonal data into local state when period changes
  useEffect(() => {
    if (!selectedPeriod) return;
    setSeasonalPriceDuration({
      price: selectedPeriod.price,
      duration: watchedValues.basePriceDuration?.duration ?? 1,
      unit: watchedValues.basePriceDuration?.unit ?? 'day',
    });
    setSeasonalRateTiers(toFormTiers(selectedPeriod.tiers));
    setSeasonalDirty(false);
  }, [selectedPeriod?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save when switching periods
  const saveCurrentSeasonalPricing = useCallback(async (periodId: string) => {
    const period = seasonalPricings.find((sp) => sp.id === periodId);
    if (!period || !seasonalPriceDuration) return;

    const payload = {
      name: period.name,
      startDate: period.startDate,
      endDate: period.endDate,
      price: seasonalPriceDuration.price.replace(',', '.'),
      rateTiers: seasonalRateTiers.map((tier) => ({
        price: tier.price.replace(',', '.'),
        duration: tier.duration,
        unit: tier.unit,
      })),
    };

    const result = await updateSeasonalPricing(periodId, payload);
    if (result && 'error' in result) {
      toastManager.add({ title: t(result.error as any) || result.error, type: 'error' });
      return false;
    }
    return true;
  }, [seasonalPriceDuration, seasonalRateTiers, seasonalPricings, t]);

  // Debounced auto-save: triggers 1.5s after the last edit
  useEffect(() => {
    if (!seasonalDirty || !selectedSeasonalPeriodId) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving');
      const success = await saveCurrentSeasonalPricing(selectedSeasonalPeriodId);
      if (success) {
        setSeasonalDirty(false);
        setAutoSaveStatus('saved');
        // Update the price in the list (for the period selector badge)
        if (onSeasonalPricingsChange && seasonalPriceDuration) {
          const updated = seasonalPricings.map((sp) => {
            if (sp.id !== selectedSeasonalPeriodId) return sp;
            return { ...sp, price: seasonalPriceDuration.price.replace(',', '.') };
          });
          onSeasonalPricingsChange(updated);
        }
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
      } else {
        setAutoSaveStatus('idle');
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [seasonalDirty, seasonalPriceDuration, seasonalRateTiers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save immediately when switching periods
  const handleSelectPeriod = useCallback(async (newPeriodId: string | null) => {
    // Clear any pending debounce timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    // Auto-save current period if dirty
    if (seasonalDirty && selectedSeasonalPeriodId) {
      await saveCurrentSeasonalPricing(selectedSeasonalPeriodId);
      if (onSeasonalPricingsChange && seasonalPriceDuration) {
        const updated = seasonalPricings.map((sp) => {
          if (sp.id !== selectedSeasonalPeriodId) return sp;
          return { ...sp, price: seasonalPriceDuration.price.replace(',', '.') };
        });
        onSeasonalPricingsChange(updated);
      }
    }
    setAutoSaveStatus('idle');
    onSelectSeasonalPeriod?.(newPeriodId);
  }, [seasonalDirty, selectedSeasonalPeriodId, saveCurrentSeasonalPricing, onSelectSeasonalPeriod, onSeasonalPricingsChange, seasonalPriceDuration, seasonalPricings]);

  const handleAddPeriod = () => {
    setEditingMetadata(null);
    setDialogOpen(true);
  };

  const handleEditMetadata = () => {
    if (!selectedPeriod) return;
    setEditingMetadata({
      id: selectedPeriod.id,
      name: selectedPeriod.name,
      startDate: selectedPeriod.startDate,
      endDate: selectedPeriod.endDate,
    });
    setDialogOpen(true);
  };

  const handlePeriodCreated = (newPeriod: SeasonalPricingData) => {
    const updated = [...seasonalPricings, newPeriod].sort(
      (a, b) => a.startDate.localeCompare(b.startDate)
    );
    onSeasonalPricingsChange?.(updated);
    onSelectSeasonalPeriod?.(newPeriod.id);
  };

  const handleMetadataUpdated = async (id: string, name: string, startDate: string, endDate: string) => {
    // Get current pricing data for the period
    const period = seasonalPricings.find((sp) => sp.id === id);
    if (!period) return;

    // Use local state values if this is the currently selected period, otherwise use stored values
    const currentPrice = id === selectedSeasonalPeriodId && seasonalPriceDuration
      ? seasonalPriceDuration.price.replace(',', '.')
      : period.price;
    const currentTiers = id === selectedSeasonalPeriodId
      ? seasonalRateTiers
      : toFormTiers(period.tiers);

    const payload = {
      name,
      startDate,
      endDate,
      price: currentPrice,
      rateTiers: currentTiers.map((tier) => ({
        price: tier.price.replace(',', '.'),
        duration: tier.duration,
        unit: tier.unit,
      })),
    };

    const result = await updateSeasonalPricing(id, payload);
    if (result && 'error' in result) {
      toastManager.add({ title: t(result.error as any) || result.error, type: 'error' });
      return;
    }

    toastManager.add({ title: t('periodSaved'), type: 'success' });
    const updated = seasonalPricings.map((sp) => {
      if (sp.id !== id) return sp;
      return { ...sp, name, startDate, endDate, price: currentPrice };
    }).sort((a, b) => a.startDate.localeCompare(b.startDate));
    onSeasonalPricingsChange?.(updated);
    setSeasonalDirty(false);
  };

  const handleDeletePeriod = async () => {
    if (!selectedPeriod) return;
    startSeasonalTransition(async () => {
      const result = await deleteSeasonalPricing(selectedPeriod.id);
      if (result && 'error' in result) {
        toastManager.add({ title: t(result.error as any) || result.error, type: 'error' });
        return;
      }
      const updated = seasonalPricings.filter((sp) => sp.id !== selectedPeriod.id);
      onSeasonalPricingsChange?.(updated);
      onSelectSeasonalPeriod?.(null);
      setDeleteDialogOpen(false);
    });
  };

  const handleDuplicatePeriod = async () => {
    if (!selectedPeriod) return;
    // Auto-save first if dirty
    if (seasonalDirty) {
      await saveCurrentSeasonalPricing(selectedPeriod.id);
    }
    startSeasonalTransition(async () => {
      const result = await duplicateSeasonalPricing(selectedPeriod.id);
      if (result && 'error' in result) {
        toastManager.add({ title: t(result.error as any) || result.error, type: 'error' });
        return;
      }
      if (result && 'id' in result) {
        // Reload by refetching - parent will handle this
        // For now, add a placeholder and select it
        toastManager.add({ title: t('seasonDuplicated'), type: 'success' });
        // We need to reload the full list since we don't have the duplicated data
        // Signal the parent to reload
        onSeasonalPricingsChange?.([]);
        onSelectSeasonalPeriod?.(result.id);
      }
    });
  };

  // Chart data for the currently edited seasonal period
  const tCommon = useTranslations('common');
  const seasonalValidRates: Rate[] = useMemo(
    () =>
      seasonalRateTiers
        .map((tier, index) => ({
          id: tier.id ?? `seasonal-${index}`,
          price: Number.parseFloat(tier.price.replace(',', '.')) || 0,
          period: priceDurationToMinutes(tier.duration, tier.unit),
          displayOrder: index,
        }))
        .filter((r) => r.price > 0 && r.period > 0),
    [seasonalRateTiers],
  );

  const seasonalBasePeriod = seasonalPriceDuration
    ? priceDurationToMinutes(seasonalPriceDuration.duration, seasonalPriceDuration.unit)
    : 0;
  const seasonalBasePrice = seasonalPriceDuration
    ? Number.parseFloat(seasonalPriceDuration.price.replace(',', '.')) || 0
    : 0;
  const seasonalChartMaxMinutes = useMemo(
    () => resolveChartMaxMinutes(seasonalChartRangePreset),
    [seasonalChartRangePreset],
  );

  const seasonalChartData = useMemo(
    () =>
      buildChartData(
        seasonalBasePrice,
        seasonalBasePeriod,
        seasonalValidRates,
        tCommon,
        seasonalChartMaxMinutes,
      ),
    [
      seasonalBasePrice,
      seasonalBasePeriod,
      seasonalValidRates,
      tCommon,
      seasonalChartMaxMinutes,
    ],
  );

  const seasonalChartAnchorTicks = useMemo(
    () => buildChartTicks(seasonalChartData),
    [seasonalChartData],
  );

  // Seasonal banner for when a period is selected
  const seasonalBanner = selectedPeriod ? (
    <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <CalendarRange className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{selectedPeriod.name}</p>
        <p className="text-muted-foreground text-xs mt-0.5">
          {format(new Date(selectedPeriod.startDate + 'T00:00:00'), 'd MMM yyyy', { locale: calendarLocale })}
          {' → '}
          {format(new Date(selectedPeriod.endDate + 'T00:00:00'), 'd MMM yyyy', { locale: calendarLocale })}
        </p>
      </div>
      {autoSaveStatus !== 'idle' && (
        <div className="flex items-center gap-1.5 self-center shrink-0">
          {autoSaveStatus === 'saving' && (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t('savingPeriod')}</span>
            </>
          )}
          {autoSaveStatus === 'saved' && (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              <span className="text-xs text-emerald-600">{t('periodSaved')}</span>
            </>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleEditMetadata}
        >
          <Pencil className="h-3 w-3" />
          {t('editPeriodMetadata')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="h-7 w-7" />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleDuplicatePeriod}>
              <Copy className="mr-2 h-4 w-4" />
              {t('duplicateSeason')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('deleteSeason')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  ) : null;

  const pricingCard = (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t('pricing')}</CardTitle>
            <CardDescription className="mt-1.5">
              {t('pricingDescription')}
            </CardDescription>
          </div>
          {productId && (
            <PricingPeriodSelector
              selectedPeriodId={selectedSeasonalPeriodId}
              seasonalPricings={seasonalPricings}
              basePriceValue={watchedValues.basePriceDuration?.price}
              onSelectPeriod={handleSelectPeriod}
              onAddPeriod={handleAddPeriod}
              isLoading={isLoadingSeasonalPricings}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Seasonal mode: banner + inline price/tiers editing */}
        {isSeasonalMode && selectedPeriod ? (
          <>
            {seasonalBanner}
            {/* Seasonal base price */}
            <div className="space-y-2">
              <Label>{t('seasonBasePrice')}</Label>
              <PriceDurationInput
                value={seasonalPriceDuration ?? { price: '', duration: 1, unit: 'day' }}
                onChange={(next) => {
                  setSeasonalPriceDuration(next);
                  setSeasonalDirty(true);
                }}
                currency={currency}
                disabled={isSaving || isSavingSeasonal}
              />
              <p className="text-muted-foreground text-xs">
                {t('seasonBasePriceHint')}
              </p>
            </div>
            {/* Seasonal rate tiers */}
            <RatesEditor
              basePriceDuration={seasonalPriceDuration}
              rates={seasonalRateTiers}
              onChange={(next) => {
                setSeasonalRateTiers(next);
                setSeasonalDirty(true);
              }}
              enforceStrictTiers={false}
              onEnforceStrictTiersChange={() => {}}
              currency={currency}
              disabled={isSaving || isSavingSeasonal}
              hideProgressiveToggle
            />
            {/* Seasonal pricing curve preview */}
            {seasonalChartData.length > 0 && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                {SHOW_DEV_CHART_RANGE_SELECTOR && (
                  <div className="mb-3 flex justify-end">
                    <Select
                      value={seasonalChartRangePreset}
                      onValueChange={(value) =>
                        setSeasonalChartRangePreset(value as ChartRangePreset)
                      }
                    >
                      <SelectTrigger className="w-[110px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHART_RANGE_PRESETS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <PricingChart
                  data={seasonalChartData}
                  anchorTicks={seasonalChartAnchorTicks}
                  isProgressive={!(watchedValues.enforceStrictTiers ?? true)}
                  gradientId="seasonal"
                  currency={currency}
                  tCommon={tCommon}
                  t={t}
                />
              </div>
            )}
            {/* Hint to go back to base pricing for TVA/deposit/progressive */}
            <div className="flex items-start gap-2.5 rounded-lg border border-muted bg-muted/30 px-3.5 py-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 text-sm text-muted-foreground">
                <span>{t('seasonalSettingsHint')}</span>
                {' '}
                <button
                  type="button"
                  className="inline font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => onSelectSeasonalPeriod?.(null)}
                >
                  {t('switchToBasePricing')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Base pricing mode: original content */}
            <form.Field name="basePriceDuration">
              {(field) => {
                const fallbackBaseRate: PriceDurationValue = {
                  price: watchedValues.price || '',
                  duration: 1,
                  unit:
                    watchedValues.pricingMode === 'week'
                      ? 'week'
                      : watchedValues.pricingMode === 'hour'
                        ? 'hour'
                        : 'day',
                };
                const baseRateValue = field.state.value ?? fallbackBaseRate;
                const showBaseRateHighlight =
                  highlightBaseRate && !hasValidBaseRate(baseRateValue);

                return (
                  <div className="space-y-2">
                    <Label>{t('baseRate')}</Label>
                    <PriceDurationInput
                      value={baseRateValue}
                      onChange={(next) => {
                        field.handleChange(next);
                        form.setFieldValue('price', next.price);
                        form.setFieldValue(
                          'pricingMode',
                          toLegacyPricingMode(next.unit),
                        );
                        if (highlightBaseRate && hasValidBaseRate(next)) {
                          setHighlightBaseRate(false);
                        }
                      }}
                      currency={currency}
                      disabled={isSaving}
                      invalid={showBaseRateHighlight}
                    />
                    <p className="text-muted-foreground text-sm">
                      {t('baseRateDescription')}
                    </p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm font-medium">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                );
              }}
            </form.Field>
            <form.Field name="rateTiers">
              {(field) => (
                <div>
                  <RatesEditor
                    basePriceDuration={watchedValues.basePriceDuration}
                    rates={field.state.value || []}
                    onChange={(next) => {
                      field.handleChange(next);
                      onRateTiersEdit?.();
                    }}
                    enforceStrictTiers={watchedValues.enforceStrictTiers ?? true}
                    onEnforceStrictTiersChange={(value) =>
                      form.setFieldValue('enforceStrictTiers', value)
                    }
                    onRequireBaseRate={() => setHighlightBaseRate(true)}
                    invalidRateIndexes={duplicateRateTierIndexes}
                    currency={currency}
                    disabled={isSaving}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm font-medium">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
            {storeTaxSettings?.enabled && (
              <>
                <Separator />
                <div className="space-y-4">
                  <form.AppField name="taxSettings.inheritFromStore">
                    {(field) => (
                      <field.Switch
                        label={t('inheritTax')}
                        description={t('inheritTaxDescription', {
                          rate: storeTaxSettings.defaultRate,
                        })}
                      />
                    )}
                  </form.AppField>

                  {!watchedValues.taxSettings?.inheritFromStore && (
                    <form.Field name="taxSettings.customRate">
                      {(field) => (
                        <div className="space-y-2">
                          <Label>{t('customTaxRate')}</Label>
                          <div className="relative w-32">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              placeholder="20"
                              className="pr-8"
                              value={field.state.value ?? ''}
                              onChange={(event) =>
                                field.handleChange(
                                  event.target.value
                                    ? parseFloat(event.target.value)
                                    : undefined,
                                )
                              }
                              onBlur={field.handleBlur}
                            />
                            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center">
                              %
                            </span>
                          </div>
                          <p className="text-muted-foreground text-sm">
                            {t('customTaxRateDescription')}
                          </p>
                          {field.state.meta.errors.length > 0 && (
                            <p className="text-destructive text-sm font-medium">
                              {getFieldError(field.state.meta.errors[0])}
                            </p>
                          )}
                        </div>
                      )}
                    </form.Field>
                  )}
                </div>
              </>
            )}
            <Separator />
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <form.AppField name="deposit">
                {(field) => (
                  <field.Input
                    label={t('deposit')}
                    suffix={currencySymbol}
                    placeholder={t('depositPlaceholder')}
                    description={t('depositHelp')}
                  />
                )}
              </form.AppField>
            </div>
          </>
        )}
      </CardContent>

      {/* Seasonal period form dialog */}
      {productId && (
        <SeasonalPeriodFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          productId={productId}
          editingData={editingMetadata}
          basePriceDuration={watchedValues.basePriceDuration}
          baseRateTiers={watchedValues.rateTiers || []}
          onCreated={handlePeriodCreated}
          onUpdated={handleMetadataUpdated}
        />
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteSeasonTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteSeasonDescription', { name: selectedPeriod?.name || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  onClick={handleDeletePeriod}
                  disabled={isSavingSeasonal}
                />
              }
            >
              {t('deleteSeason')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );

  const stockCard = (
    <Card>
      <CardHeader>
        <CardTitle>{t('stock')}</CardTitle>
        <CardDescription>{t('quantityHelp')}</CardDescription>
      </CardHeader>
      <CardContent>
        <UnitTrackingEditor
          trackUnits={watchedValues.trackUnits || false}
          onTrackUnitsChange={(value) =>
            form.setFieldValue('trackUnits', value)
          }
          bookingAttributeAxes={watchedValues.bookingAttributeAxes || []}
          onBookingAttributeAxesChange={(axes) =>
            form.setFieldValue('bookingAttributeAxes', axes)
          }
          units={watchedValues.units || []}
          onChange={(units) => form.setFieldValue('units', units)}
          quantity={watchedValues.quantity || '1'}
          onQuantityChange={(value) => {
            form.setFieldMeta('quantity', (prev: any) => ({
              ...prev,
              errorMap: { ...prev?.errorMap, onSubmit: undefined },
            }));
            form.setFieldValue('quantity', value);
          }}
          disabled={isSaving}
          showValidationErrors={showUnitValidationErrors}
        />
      </CardContent>
    </Card>
  );

  const accessoriesCard = (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          {t('accessories')}
        </CardTitle>
        <CardDescription>{t('accessoriesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {availableAccessories.length > 0 ? (
          <form.Field name="accessoryIds">
            {(field) => (
              <div>
                <AccessoriesSelector
                  availableProducts={availableAccessories}
                  selectedIds={field.state.value || []}
                  onChange={field.handleChange}
                  currency={currency}
                  disabled={isSaving}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="bg-muted mb-3 rounded-full p-3">
              <Puzzle className="text-muted-foreground h-6 w-6" />
            </div>
            <p className="text-sm font-medium">{t('noAccessoriesAvailable')}</p>
            <p className="text-muted-foreground mt-1 max-w-[260px] text-sm">
              {t('noAccessoriesHint')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Pricing-only mode (edit mode renders stock/accessories as separate sections)
  if (!showStock && !showAccessories) {
    return pricingCard;
  }

  // Full step mode (create stepper): pricing + stock in a grid, optionally accessories
  if (showAccessories) {
    return (
      <>
        <div className="grid gap-6">
          {pricingCard}
          {stockCard}
        </div>
        {accessoriesCard}
      </>
    );
  }

  return (
    <div className="grid gap-6">
      {pricingCard}
      {stockCard}
    </div>
  );
}
