'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { Eye, HelpCircle, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  ReferenceDot,
} from 'recharts';

import type { Rate } from '@louez/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
  DialogClose,
  DialogFooter,
  Input,
  Label,
  Switch,
} from '@louez/ui';
import {
  type DurationUnit,
  calculateRateBasedPrice,
  computeReductionPercent,
  formatCurrency,
  minutesToPriceDuration,
  priceDurationToMinutes,
} from '@louez/utils';

import {
  PriceDurationInput,
  type PriceDurationValue,
} from '@/components/ui/price-duration-input';

interface RateEditorRow {
  id?: string;
  price: string;
  duration: number;
  unit: DurationUnit;
  // UI-only derived value. Never persisted.
  discountPercent?: number;
}

interface RatesEditorProps {
  basePriceDuration?: PriceDurationValue;
  rates: RateEditorRow[];
  onChange: (rates: RateEditorRow[]) => void;
  enforceStrictTiers: boolean;
  onEnforceStrictTiersChange: (value: boolean) => void;
  onRequireBaseRate?: () => void;
  invalidRateIndexes?: number[];
  currency: string;
  disabled?: boolean;
  hideProgressiveToggle?: boolean;
}

interface ChartDataPoint {
  durationMinutes: number
  durationLabel: string
  strictTotal: number
  progressiveTotal: number
  isTierAnchor: boolean
}

/**
 * Format a duration in minutes into a compact human-readable label.
 * Examples: "4h", "2j", "1j 12h", "1sem".
 * Compound labels are used when a value doesn't divide evenly into the
 * larger unit (e.g. 2160 min → "1j 12h" instead of "1.5j").
 */
function formatDurationShort(
  minutes: number,
  tCommon: (key: string, opts: { count: number }) => string,
): string {
  const abbrev = (unit: DurationUnit, count: number) => {
    const key =
      unit === 'minute'
        ? 'minuteUnit'
        : unit === 'hour'
          ? 'hourUnit'
          : unit === 'week'
            ? 'weekUnit'
            : 'dayUnit';
    return `${count}${tCommon(key, { count }).charAt(0).toLowerCase()}`;
  };

  if (minutes >= 10080 && minutes % 10080 === 0) {
    return abbrev('week', minutes / 10080);
  }
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const remainingHours = Math.round((minutes % 1440) / 60);
    if (remainingHours === 0) return abbrev('day', days);
    return `${abbrev('day', days)} ${abbrev('hour', remainingHours)}`;
  }
  if (minutes >= 60) {
    return abbrev('hour', Math.round(minutes / 60));
  }
  return abbrev('minute', minutes);
}

/**
 * Format a duration in minutes into a full human-readable label for tooltips.
 * Examples: "4 heures", "2 jours", "1 jour 12 heures".
 */
function formatDurationLong(
  minutes: number,
  tCommon: (key: string, opts: { count: number }) => string,
): string {
  const full = (unit: DurationUnit, count: number) => {
    const key =
      unit === 'minute'
        ? 'minuteUnit'
        : unit === 'hour'
          ? 'hourUnit'
          : unit === 'week'
            ? 'weekUnit'
            : 'dayUnit';
    return `${count} ${tCommon(key, { count })}`;
  };

  if (minutes >= 10080 && minutes % 10080 === 0) {
    return full('week', minutes / 10080);
  }
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const remainingHours = Math.round((minutes % 1440) / 60);
    if (remainingHours === 0) return full('day', days);
    return `${full('day', days)} ${full('hour', remainingHours)}`;
  }
  if (minutes >= 60) {
    return full('hour', Math.round(minutes / 60));
  }
  return full('minute', minutes);
}

const DURATION_MULTIPLIERS_BY_UNIT: Record<DurationUnit, number[]> = {
  minute: [1, 2, 6, 12, 24],
  hour: [1, 2, 4, 8, 24],
  day: [1, 3, 7, 14, 30],
  week: [1, 2, 4, 8, 12],
};

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortRatesByDuration(rates: RateEditorRow[]): RateEditorRow[] {
  return [...rates].sort((a, b) => {
    const durationDiff =
      priceDurationToMinutes(a.duration, a.unit) -
      priceDurationToMinutes(b.duration, b.unit);

    if (durationDiff !== 0) return durationDiff;

    return toNumber(a.price) - toNumber(b.price);
  });
}

function nextTierDuration(params: {
  unit: DurationUnit;
  currentDuration: number;
  baseDuration?: number;
}): number {
  const { unit, currentDuration, baseDuration } = params;
  const safeCurrent = Math.max(1, Math.round(currentDuration || 1));
  const safeBase = Math.max(1, Math.round(baseDuration || 1));
  const candidateDurations = DURATION_MULTIPLIERS_BY_UNIT[unit].map(
    (multiplier) => multiplier * safeBase,
  );
  const next = candidateDurations.find((duration) => duration > safeCurrent);
  if (next) return next;
  return Math.max(safeCurrent + 1, Math.ceil(safeCurrent * 1.5));
}

export function RatesEditor({
  basePriceDuration,
  rates,
  onChange,
  enforceStrictTiers,
  onEnforceStrictTiersChange,
  onRequireBaseRate,
  invalidRateIndexes = [],
  currency,
  disabled = false,
  hideProgressiveToggle = false,
}: RatesEditorProps) {
  const t = useTranslations('dashboard.products.form');
  const tCommon = useTranslations('common');
  const invalidIndexes = useMemo(
    () => new Set(invalidRateIndexes),
    [invalidRateIndexes],
  );
  const basePrice = basePriceDuration ? toNumber(basePriceDuration.price) : 0;
  const basePeriod = basePriceDuration
    ? priceDurationToMinutes(basePriceDuration.duration, basePriceDuration.unit)
    : 0;
  const baseUnitLabel = basePriceDuration
    ? tCommon(
        `${
          basePriceDuration.unit === 'minute'
            ? 'minuteUnit'
            : basePriceDuration.unit === 'hour'
              ? 'hourUnit'
              : basePriceDuration.unit === 'week'
                ? 'weekUnit'
                : 'dayUnit'
        }`,
        { count: basePriceDuration.duration || 1 },
      )
    : null;

  const validRates: Rate[] = useMemo(
    () =>
      rates
        .map((rate, index) => ({
          id: rate.id ?? `temp-${index}`,
          price: toNumber(rate.price),
          period: priceDurationToMinutes(rate.duration, rate.unit),
          displayOrder: index,
        }))
        .filter((rate) => rate.price > 0 && rate.period > 0),
    [rates],
  );

  const previewDurations = useMemo(() => {
    if (!basePeriod) return [];
    if (enforceStrictTiers) {
      return [basePeriod, ...validRates.map((rate) => rate.period)].sort(
        (a, b) => a - b,
      );
    }

    const multipliers =
      DURATION_MULTIPLIERS_BY_UNIT[basePriceDuration?.unit ?? 'day'];
    const byBase = multipliers.map((multiplier) => basePeriod * multiplier);
    return [
      ...new Set([...byBase, ...validRates.map((rate) => rate.period)]),
    ].sort((a, b) => a - b);
  }, [basePeriod, basePriceDuration?.unit, enforceStrictTiers, validRates]);

  const previewRows = useMemo(() => {
    if (!basePrice || !basePeriod) return [];

    const pricingBase = {
      basePrice,
      basePeriodMinutes: basePeriod,
      deposit: 0,
      rates: validRates,
    };

    return previewDurations.map((durationMinutes) => {
      const strictResult = calculateRateBasedPrice(
        { ...pricingBase, enforceStrictTiers: true },
        durationMinutes,
        1,
      );
      const progressiveResult = calculateRateBasedPrice(
        { ...pricingBase, enforceStrictTiers: false },
        durationMinutes,
        1,
      );

      const currentResult = enforceStrictTiers
        ? strictResult
        : progressiveResult;
      const unitPrice =
        (currentResult.subtotal / Math.max(1, durationMinutes)) * basePeriod;
      const durationInfo = minutesToPriceDuration(durationMinutes);
      const durationLabel = `${durationInfo.duration} ${tCommon(
        `${
          durationInfo.unit === 'minute'
            ? 'minuteUnit'
            : durationInfo.unit === 'hour'
              ? 'hourUnit'
              : durationInfo.unit === 'week'
                ? 'weekUnit'
                : 'dayUnit'
        }`,
        { count: durationInfo.duration },
      )}`;

      return {
        durationMinutes,
        durationLabel,
        unitPrice,
        total: currentResult.subtotal,
        savings: strictResult.subtotal - progressiveResult.subtotal,
        reductionPercent: currentResult.reductionPercent,
      };
    });
  }, [
    basePeriod,
    basePrice,
    enforceStrictTiers,
    previewDurations,
    tCommon,
    validRates,
  ]);

  const chartData: ChartDataPoint[] = useMemo(() => {
    if (!basePrice || !basePeriod || validRates.length === 0) return [];

    const anchors = [
      basePeriod,
      ...validRates.map((r) => r.period),
    ].sort((a, b) => a - b);
    const anchorSet = new Set(anchors);

    // Standard step sizes (minutes). We pick the one that gives 3-12
    // intermediate points between consecutive anchors.
    const CLEAN_STEPS = [
      15, 30, 60, 120, 240, 360, 720, 1440, 2880, 4320, 10080,
    ];
    function pickStep(range: number): number {
      for (const s of CLEAN_STEPS) {
        const n = Math.floor(range / s) - 1;
        if (n >= 2 && n <= 12) return s;
      }
      return CLEAN_STEPS[CLEAN_STEPS.length - 1];
    }

    const sampleSet = new Set<number>();
    for (const a of anchors) sampleSet.add(a);

    // Intermediate points at clean multiples between each anchor pair
    for (let i = 0; i < anchors.length - 1; i++) {
      const lo = anchors[i];
      const hi = anchors[i + 1];
      const step = pickStep(hi - lo);
      const start = Math.ceil((lo + 1) / step) * step;
      for (let v = start; v < hi; v += step) {
        sampleSet.add(v);
      }
    }

    // Extrapolation beyond last anchor (3 clean points)
    const last = anchors[anchors.length - 1];
    const prevAnchor = anchors.length > 1 ? anchors[anchors.length - 2] : 0;
    const extraStep = pickStep(last - prevAnchor || last);
    for (let i = 1; i <= 3; i++) {
      sampleSet.add(last + extraStep * i);
    }

    const pricingBase = {
      basePrice,
      basePeriodMinutes: basePeriod,
      deposit: 0,
      rates: validRates,
    };

    return [...sampleSet]
      .sort((a, b) => a - b)
      .map((mins) => ({
        durationMinutes: mins,
        durationLabel: formatDurationShort(mins, tCommon),
        strictTotal: calculateRateBasedPrice(
          { ...pricingBase, enforceStrictTiers: true },
          mins,
          1,
        ).subtotal,
        progressiveTotal: calculateRateBasedPrice(
          { ...pricingBase, enforceStrictTiers: false },
          mins,
          1,
        ).subtotal,
        isTierAnchor: anchorSet.has(mins),
      }));
  }, [basePeriod, basePrice, validRates, tCommon]);

  const chartAnchorTicks = useMemo(
    () => chartData.filter((p) => p.isTierAnchor).map((p) => p.durationMinutes),
    [chartData],
  );

  const renderChartTooltip = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ active, payload }: any) => {
      if (!active || !payload?.length) return null;
      const data = payload[0].payload as ChartDataPoint;
      const label = formatDurationLong(data.durationMinutes, tCommon);
      const savings = data.strictTotal - data.progressiveTotal;

      return (
        <div className="rounded-lg border bg-background p-3 text-sm shadow-lg">
          <p className="mb-1.5 font-medium">{label}</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-0 w-3 border-t-[1.5px] border-dashed"
                style={{ borderColor: 'var(--muted-foreground)' }}
              />
              <span className="text-muted-foreground">
                {t('pricingTiers.chart.strictLine')}: {formatCurrency(data.strictTotal, currency)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-3 rounded bg-emerald-500" />
              <span>
                {t('pricingTiers.chart.progressiveLine')}: {formatCurrency(data.progressiveTotal, currency)}
              </span>
            </div>
            {savings > 0 && (
              <p className="mt-1 border-t pt-1 font-medium text-emerald-600 dark:text-emerald-400">
                {t('pricingTiers.chart.savings')}: −{formatCurrency(savings, currency)}
              </p>
            )}
          </div>
        </div>
      );
    },
    [t, tCommon, currency],
  );

  const hasBaseRate = basePrice > 0 && basePeriod > 0;
  const hasMultipleDistinctPrices = useMemo(() => {
    if (!hasBaseRate) return false;

    const perMinuteKeys = new Set<string>();
    perMinuteKeys.add((basePrice / basePeriod).toFixed(6));

    for (const rate of validRates) {
      perMinuteKeys.add((rate.price / rate.period).toFixed(6));
      if (perMinuteKeys.size >= 2) return true;
    }

    return false;
  }, [basePeriod, basePrice, hasBaseRate, validRates]);

  const emitRatesChange = (nextRates: RateEditorRow[]) => {
    onChange(sortRatesByDuration(nextRates));
  };

  const addRate = () => {
    if (!hasBaseRate) {
      onRequireBaseRate?.();
      return;
    }

    const lastRate = rates.at(-1);
    const referenceUnit = lastRate?.unit ?? basePriceDuration?.unit ?? 'day';
    const currentDuration =
      lastRate?.duration ?? basePriceDuration?.duration ?? 1;
    const baseDurationForUnit =
      basePriceDuration?.unit === referenceUnit
        ? basePriceDuration.duration
        : undefined;
    const duration = nextTierDuration({
      unit: referenceUnit,
      currentDuration,
      baseDuration: baseDurationForUnit,
    });
    const period = priceDurationToMinutes(duration, referenceUnit);

    let price = '';
    let discountPercent: number | undefined = undefined;

    if (hasBaseRate) {
      const lastRateWithPrice = [...rates]
        .reverse()
        .find((rate) => toNumber(rate.price) > 0 && rate.duration > 0);
      const previousDiscount = lastRateWithPrice
        ? (lastRateWithPrice.discountPercent ??
          computeReductionPercent(
            basePrice,
            basePeriod,
            toNumber(lastRateWithPrice.price),
            priceDurationToMinutes(
              lastRateWithPrice.duration,
              lastRateWithPrice.unit,
            ),
          ))
        : 0;
      const nextDiscount = Math.min(
        99,
        Math.max(10, Math.round((previousDiscount + 10) * 100) / 100),
      );
      const basePerMinute = basePrice / basePeriod;
      const discountedPerMinute = basePerMinute * (1 - nextDiscount / 100);

      price = Math.max(0, discountedPerMinute * period).toFixed(2);
      discountPercent = nextDiscount;
    }

    emitRatesChange([
      ...rates,
      {
        price,
        duration,
        unit: referenceUnit,
        discountPercent,
      },
    ]);
  };

  const removeRate = (index: number) => {
    const next = rates.filter((_, i) => i !== index);
    emitRatesChange(next);
  };

  const updateRate = (index: number, next: RateEditorRow) => {
    const updated = [...rates];
    updated[index] = next;
    emitRatesChange(updated);
  };

  const updateReductionPercent = (index: number, reductionPercent: number) => {
    const rate = rates[index];
    if (!basePrice || !basePeriod) return;
    const tierPeriod = priceDurationToMinutes(rate.duration, rate.unit);
    const basePerMinute = basePrice / basePeriod;
    const tierPerMinute = basePerMinute * (1 - reductionPercent / 100);
    const tierPrice = Math.max(0, tierPerMinute * tierPeriod);
    updateRate(index, {
      ...rate,
      price: tierPrice.toFixed(2),
      discountPercent: reductionPercent,
    });
  };
  const progressiveDiscountEnabled = !enforceStrictTiers;

  return (
    <div className="space-y-3">
      {rates.map((rate, index) => {
        const isInvalidRate = invalidIndexes.has(index);
        const tierPrice = toNumber(rate.price);
        const tierPeriod = priceDurationToMinutes(rate.duration, rate.unit);
        const computedReduction =
          basePrice > 0 && basePeriod > 0 && tierPrice > 0
            ? computeReductionPercent(
                basePrice,
                basePeriod,
                tierPrice,
                tierPeriod,
              )
            : 0;
        const basePriceForDuration =
          basePrice > 0 && basePeriod > 0 && tierPeriod > 0
            ? (basePrice / basePeriod) * tierPeriod
            : 0;
        const hasDiscount =
          tierPrice > 0 &&
          basePriceForDuration > 0 &&
          tierPrice < basePriceForDuration;
        const discountPct = rate.discountPercent ?? computedReduction;

        return (
          <div
            key={rate.id ?? `new-${index}`}
            className={`group bg-card relative overflow-hidden rounded-lg border ${
              isInvalidRate ? 'border-destructive/70 bg-destructive/5' : ''
            }`}
          >
            <div className="flex flex-wrap items-center gap-3 p-2.5 sm:flex-nowrap">
              <div className="flex min-w-0 flex-col gap-1">
                <PriceDurationInput
                  value={{
                    price: rate.price,
                    duration: rate.duration,
                    unit: rate.unit,
                  }}
                  onChange={(next) =>
                    updateRate(index, {
                      ...rate,
                      price: next.price,
                      duration: next.duration,
                      unit: next.unit as DurationUnit,
                      discountPercent: undefined,
                    })
                  }
                  currency={currency}
                  disabled={disabled}
                  invalid={isInvalidRate}
                />
                {hasDiscount && (
                  <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span>
                      {t('pricingTiers.insteadOf')}{' '}
                      <span className="line-through">
                        {formatCurrency(basePriceForDuration, currency)}
                      </span>
                    </span>
                    <span className="font-medium text-emerald-600">
                      −
                      {formatCurrency(
                        basePriceForDuration - tierPrice,
                        currency,
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div className="ml-auto flex items-center gap-2.5">
                {discountPct > 0 && (
                  <div className="hidden items-center gap-2 md:flex">
                    <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{
                          width: `${Math.min(100, discountPct)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <ReductionInput
                  label={t('rateReduction')}
                  value={rate.discountPercent ?? computedReduction}
                  onCommit={(v) => updateReductionPercent(index, v)}
                  disabled={disabled || !basePriceDuration}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
                  onClick={() => removeRate(index)}
                  disabled={disabled}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {isInvalidRate && (
              <div className="px-2.5 pb-2 text-sm font-medium text-red-600">
                {t('pricingTiers.duplicateDurationError')}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRate}
          disabled={disabled}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('addRate')}
        </Button>
      </div>

      {hasMultipleDistinctPrices && !hideProgressiveToggle && (
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium">
                  {t('pricingTiers.progressive.label')}
                </Label>
                <Dialog>
                  <DialogTrigger
                    render={
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground inline-flex cursor-help transition-colors"
                      />
                    }
                  >
                    <HelpCircle className="h-4 w-4" />
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>
                        {t('pricingTiers.progressive.modal.title')}
                      </DialogTitle>
                      <DialogDescription>
                        {t('pricingTiers.progressive.modal.intro')}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogPanel>
                      <div className="space-y-3">
                        <div className="rounded-lg border p-3">
                          <p className="text-sm font-medium">
                            {t('pricingTiers.progressive.modal.withoutTitle')}
                          </p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {t('pricingTiers.progressive.modal.withoutText')}
                          </p>
                          <div className="bg-muted/50 mt-2 rounded-md px-3 py-2 text-sm">
                            {t('pricingTiers.progressive.modal.withoutExample')}
                          </div>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                            {t('pricingTiers.progressive.modal.withTitle')}
                          </p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            {t('pricingTiers.progressive.modal.withText')}
                          </p>
                          <div className="mt-2 rounded-md bg-emerald-100/50 px-3 py-2 text-sm dark:bg-emerald-950/30">
                            {t('pricingTiers.progressive.modal.withExample')}
                          </div>
                        </div>
                      </div>
                    </DialogPanel>
                    <DialogFooter>
                      <DialogClose
                        render={
                          <Button type="button" variant="outline" size="sm" />
                        }
                      >
                        {tCommon('close')}
                      </DialogClose>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <p className="text-muted-foreground text-sm">
                {t('pricingTiers.progressive.description')}
              </p>
            </div>
            <Switch
              checked={progressiveDiscountEnabled}
              onCheckedChange={(checked) =>
                onEnforceStrictTiersChange(!Boolean(checked))
              }
              disabled={disabled}
            />
          </div>

          {/* Strict mode: modal preview with chart + table */}
          {!progressiveDiscountEnabled && previewRows.length > 0 && (
            <div className="mt-3">
              <Dialog>
                <DialogTrigger
                  render={<Button type="button" variant="outline" size="sm" />}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  {t('pricingTiers.preview')}
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>{t('pricingTiers.preview')}</DialogTitle>
                    <DialogDescription>
                      {t('pricingTiers.previewDescription')}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogPanel>
                    {chartData.length > 0 && (
                      <div className="mb-4 rounded-lg border bg-card p-3">
                        <div className="h-[200px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={chartData}
                              margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                            >
                              <defs>
                                <linearGradient
                                  id="previewProgressiveGradient"
                                  x1="0"
                                  y1="0"
                                  x2="0"
                                  y2="1"
                                >
                                  <stop
                                    offset="5%"
                                    stopColor="#22c55e"
                                    stopOpacity={0.2}
                                  />
                                  <stop
                                    offset="95%"
                                    stopColor="#22c55e"
                                    stopOpacity={0}
                                  />
                                </linearGradient>
                              </defs>
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="var(--border)"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="durationMinutes"
                                type="number"
                                domain={['dataMin', 'dataMax']}
                                ticks={chartAnchorTicks}
                                tickFormatter={(mins: number) =>
                                  formatDurationShort(mins, tCommon)
                                }
                                tick={{
                                  fontSize: 11,
                                  fill: 'var(--muted-foreground)',
                                }}
                                tickLine={false}
                                axisLine={false}
                              />
                              <YAxis
                                tick={{
                                  fontSize: 11,
                                  fill: 'var(--muted-foreground)',
                                }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v: number) =>
                                  formatCurrency(v, currency)
                                }
                                width={65}
                              />
                              <RechartsTooltip content={renderChartTooltip} />
                              <Legend
                                verticalAlign="top"
                                height={28}
                                iconType="line"
                                formatter={(value: string) => (
                                  <span className="text-xs text-muted-foreground">
                                    {value}
                                  </span>
                                )}
                              />
                              <Area
                                type="linear"
                                dataKey="strictTotal"
                                name={t('pricingTiers.chart.strictLine')}
                                stroke="var(--muted-foreground)"
                                strokeWidth={1.5}
                                strokeDasharray="6 3"
                                fillOpacity={0}
                                dot={false}
                                activeDot={false}
                              />
                              <Area
                                type="monotone"
                                dataKey="progressiveTotal"
                                name={t('pricingTiers.chart.progressiveLine')}
                                stroke="#22c55e"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#previewProgressiveGradient)"
                                dot={false}
                                activeDot={false}
                              />
                              {chartData
                                .filter((p) => p.isTierAnchor)
                                .map((p) => (
                                  <ReferenceDot
                                    key={p.durationMinutes}
                                    x={p.durationMinutes}
                                    y={p.progressiveTotal}
                                    r={4}
                                    fill="#22c55e"
                                    stroke="var(--background)"
                                    strokeWidth={2}
                                  />
                                ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                    <PreviewTable
                      rows={previewRows}
                      currency={currency}
                      baseUnitLabel={baseUnitLabel}
                      t={t}
                    />
                  </DialogPanel>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {/* Progressive mode: inline chart + table */}
          {progressiveDiscountEnabled && chartData.length > 0 && (
            <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="rounded-lg border bg-card p-3">
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="progressiveGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#22c55e"
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="95%"
                            stopColor="#22c55e"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="durationMinutes"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        ticks={chartAnchorTicks}
                        tickFormatter={(mins: number) =>
                          formatDurationShort(mins, tCommon)
                        }
                        tick={{
                          fontSize: 11,
                          fill: 'var(--muted-foreground)',
                        }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{
                          fontSize: 11,
                          fill: 'var(--muted-foreground)',
                        }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) =>
                          formatCurrency(v, currency)
                        }
                        width={65}
                      />
                      <RechartsTooltip content={renderChartTooltip} />
                      <Legend
                        verticalAlign="top"
                        height={28}
                        iconType="line"
                        formatter={(value: string) => (
                          <span className="text-xs text-muted-foreground">
                            {value}
                          </span>
                        )}
                      />
                      <Area
                        type="linear"
                        dataKey="strictTotal"
                        name={t('pricingTiers.chart.strictLine')}
                        stroke="var(--muted-foreground)"
                        strokeWidth={1.5}
                        strokeDasharray="6 3"
                        fillOpacity={0}
                        dot={false}
                        activeDot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="progressiveTotal"
                        name={t('pricingTiers.chart.progressiveLine')}
                        stroke="#22c55e"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#progressiveGradient)"
                        dot={false}
                        activeDot={false}
                      />
                      {chartData
                        .filter((p) => p.isTierAnchor)
                        .map((p) => (
                          <ReferenceDot
                            key={p.durationMinutes}
                            x={p.durationMinutes}
                            y={p.progressiveTotal}
                            r={4}
                            fill="#22c55e"
                            stroke="var(--background)"
                            strokeWidth={2}
                          />
                        ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {previewRows.length > 0 && (
                <div className="mt-3">
                  <PreviewTable
                    rows={previewRows}
                    currency={currency}
                    baseUnitLabel={baseUnitLabel}
                    t={t}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReductionInput({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  function commit() {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft);
    if (!Number.isNaN(parsed)) {
      onCommit(Math.max(0, Math.min(99, parsed)));
    }
    setDraft(null);
  }

  return (
    <div className="relative">
      <Input
        ref={ref}
        type="number"
        min={0}
        max={99}
        step="any"
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            ref.current?.blur();
          }
        }}
        disabled={disabled}
        className="h-9 w-28 pr-7 text-sm [&_input]:[-moz-appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none"
        aria-label={label}
      />
      <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 z-10 flex items-center text-xs">
        %
      </span>
    </div>
  );
}

function PreviewTable({
  rows,
  currency,
  baseUnitLabel,
  t,
  showSavings = true,
}: {
  rows: Array<{
    durationMinutes: number;
    durationLabel: string;
    unitPrice: number;
    total: number;
    savings: number;
    reductionPercent: number | null;
  }>;
  currency: string;
  baseUnitLabel: string | null;
  t: (key: string) => string;
  showSavings?: boolean;
}) {
  const gridCols = showSavings
    ? 'grid-cols-[1fr_auto_auto_auto]'
    : 'grid-cols-[1fr_auto_auto]';

  return (
    <div className="space-y-1">
      <div
        className={`text-muted-foreground grid ${gridCols} gap-x-4 px-2 pb-1 text-xs font-medium`}
      >
        <span>{t('pricingTiers.duration')}</span>
        <span>{t('pricingTiers.pricePerUnit')}</span>
        <span className="text-right">{t('pricingTiers.total')}</span>
        {showSavings && (
          <span className="text-right">{t('pricingTiers.savings')}</span>
        )}
      </div>
      {rows.map((row) => {
        const reductionPercent = row.reductionPercent ?? 0;
        return (
          <div
            key={row.durationMinutes}
            className={`grid ${gridCols} items-center gap-x-4 rounded-md px-2 py-1.5 text-sm ${
              showSavings && row.savings > 0 ? 'bg-emerald-500/5' : ''
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <span>{row.durationLabel}</span>
              {reductionPercent > 0 && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  -{Math.floor(reductionPercent)}%
                </span>
              )}
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatCurrency(row.unitPrice, currency)}
              {baseUnitLabel ? ` / ${baseUnitLabel}` : ''}
            </span>
            <span className="text-right font-medium tabular-nums">
              {formatCurrency(row.total, currency)}
            </span>
            {showSavings && (
              <span
                className={`text-right text-xs tabular-nums ${
                  row.savings > 0
                    ? 'font-medium text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground'
                }`}
              >
                {row.savings > 0
                  ? `−${formatCurrency(row.savings, currency)}`
                  : '-'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
