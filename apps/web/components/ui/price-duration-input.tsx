'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import { Input } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { cn, getCurrencySymbol } from '@louez/utils';

export type DurationUnit = 'minute' | 'hour' | 'day' | 'week';

export interface PriceDurationValue {
  price: string;
  duration: number;
  unit: DurationUnit;
}

const DURATION_UNITS: DurationUnit[] = ['minute', 'hour', 'day', 'week'];

const DEFAULT_VALUE: PriceDurationValue = {
  price: '',
  duration: 1,
  unit: 'day',
};

export interface PriceDurationInputProps {
  value?: PriceDurationValue;
  onChange?: (value: PriceDurationValue) => void;
  defaultValue?: PriceDurationValue;
  currency?: string;
  className?: string;
  disabled?: boolean;
}

export function PriceDurationInput({
  value: controlledValue,
  onChange,
  defaultValue,
  currency = 'EUR',
  className,
  disabled,
}: PriceDurationInputProps) {
  const t = useTranslations('common');
  const symbol = getCurrencySymbol(currency);
  const [uncontrolledValue, setUncontrolledValue] =
    useState<PriceDurationValue>(defaultValue ?? DEFAULT_VALUE);

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolledValue;

  function handleChange(next: PriceDurationValue) {
    if (!isControlled) setUncontrolledValue(next);
    onChange?.(next);
  }

  const unitLabelKeys: Record<DurationUnit, string> = {
    minute: 'minuteUnit',
    hour: 'hourUnit',
    day: 'dayUnit',
    week: 'weekUnit',
  };

  function getUnitLabel(unit: DurationUnit) {
    return t(unitLabelKeys[unit], { count: value.duration });
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          value={value.price}
          onChange={(e) => handleChange({ ...value, price: e.target.value })}
          disabled={disabled}
          className="w-28 pr-8"
          placeholder="0.00"
        />
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
          {symbol}
        </span>
      </div>

      <span className="text-muted-foreground text-sm">/</span>

      <Input
        type="number"
        min={1}
        value={value.duration}
        onChange={(e) =>
          handleChange({ ...value, duration: parseInt(e.target.value) || 1 })
        }
        disabled={disabled}
        className="w-20"
      />

      <Select
        value={value.unit}
        onValueChange={(unit) => {
          if (unit !== null)
            handleChange({ ...value, unit: unit as DurationUnit });
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue>{getUnitLabel(value.unit)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DURATION_UNITS.map((unit) => (
            <SelectItem key={unit} value={unit}>
              {getUnitLabel(unit)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
