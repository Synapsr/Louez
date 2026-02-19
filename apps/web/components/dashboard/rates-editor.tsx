'use client';

import { useMemo, useRef, useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Rate } from '@louez/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui';
import {
  type DurationUnit,
  calculateRentalPriceV2,
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
  currency: string;
  disabled?: boolean;
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
  currency,
  disabled = false,
}: RatesEditorProps) {
  const t = useTranslations('dashboard.products.form');
  const tCommon = useTranslations('common');
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
    if (enforceStrictTiers && validRates.length > 0) {
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

    return previewDurations.map((durationMinutes) => {
      const result = calculateRentalPriceV2(
        {
          basePrice,
          basePeriodMinutes: basePeriod,
          deposit: 0,
          rates: validRates,
          enforceStrictTiers,
        },
        durationMinutes,
        1,
      );

      const unitPrice =
        (result.subtotal / Math.max(1, durationMinutes)) * basePeriod;
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
        total: result.subtotal,
        savings: result.savings,
        reductionPercent: result.reductionPercent,
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

  const addRate = () => {
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
    const hasBaseRate = basePrice > 0 && basePeriod > 0;

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

    onChange([
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
    onChange(rates.filter((_, i) => i !== index));
  };

  const updateRate = (index: number, next: RateEditorRow) => {
    const updated = [...rates];
    updated[index] = next;
    onChange(updated);
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

  return (
    <div className="space-y-3">
      {/* <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {t('additionalRates')}
        </Label>
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
      </div> */}

      {rates.map((rate, index) => {
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
            className="group bg-card relative overflow-hidden rounded-lg border"
          >
            <div className="flex flex-wrap items-center gap-3 p-2.5 sm:flex-nowrap">
              {/* Price + duration input */}
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

              {/* Discount visualization + input + delete */}
              <div className="ml-auto flex items-center gap-2.5">
                {/* Mini progress bar (md+ only) */}
                {discountPct > 0 && (
                  <div className="hidden items-center gap-2 md:flex">
                    <div className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${Math.min(100, discountPct)}%` }}
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
          </div>
        );
      })}

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

      {rates.length >= 1 && (
        <>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                {t('pricingTiers.enforceStrictTiers')}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t('pricingTiers.enforceStrictTiersDescription')}
              </p>
            </div>
            <Switch
              checked={enforceStrictTiers}
              onCheckedChange={(checked) =>
                onEnforceStrictTiersChange(Boolean(checked))
              }
              disabled={disabled}
            />
          </div>
          {enforceStrictTiers && (
            <p className="text-muted-foreground bg-muted/20 rounded-md border border-dashed px-3 py-2 text-xs">
              {t('pricingTiers.enforceStrictTiersTooltip')}
            </p>
          )}
        </>
      )}

      {rates.length >= 1 && previewRows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t('pricingTiers.preview')}
            </CardTitle>
            <CardDescription>
              {t('pricingTiers.previewDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('pricingTiers.duration')}</TableHead>
                    <TableHead>{t('pricingTiers.pricePerUnit')}</TableHead>
                    <TableHead className="text-right">
                      {t('pricingTiers.total')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('pricingTiers.savings')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row) => {
                    const reductionPercent = row.reductionPercent ?? 0;
                    return (
                      <TableRow
                        key={row.durationMinutes}
                        className={
                          row.savings > 0 ? 'bg-green-50/40' : undefined
                        }
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{row.durationLabel}</span>
                            {reductionPercent > 0 && (
                              <Badge
                                variant="outline"
                                className="text-emerald-700"
                              >
                                -{Math.floor(reductionPercent)}%
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatCurrency(row.unitPrice, currency)}
                          {baseUnitLabel ? ` / ${baseUnitLabel}` : ''}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(row.total, currency)}
                        </TableCell>
                        <TableCell
                          className={`text-right ${
                            row.savings > 0
                              ? 'text-emerald-700'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {row.savings > 0
                            ? `-${formatCurrency(row.savings, currency)}`
                            : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
        step="0.01"
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
