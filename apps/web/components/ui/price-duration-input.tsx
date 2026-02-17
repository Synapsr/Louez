'use client';

import { useRef, useState } from 'react';

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

  // Draft state for text inputs — commit only on blur/Enter
  const [draftPrice, setDraftPrice] = useState<string | null>(null);
  const [draftDuration, setDraftDuration] = useState<string | null>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  function handleChange(next: PriceDurationValue) {
    if (!isControlled) setUncontrolledValue(next);
    onChange?.(next);
  }

  function commitPrice() {
    if (draftPrice !== null) {
      handleChange({ ...value, price: draftPrice });
      setDraftPrice(null);
    }
  }

  function commitDuration() {
    if (draftDuration !== null) {
      handleChange({ ...value, duration: parseInt(draftDuration) || 0 });
      setDraftDuration(null);
    }
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
          ref={priceRef}
          type="text"
          inputMode="decimal"
          value={draftPrice ?? value.price}
          onChange={(e) => setDraftPrice(e.target.value)}
          onBlur={commitPrice}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitPrice();
              priceRef.current?.blur();
            }
          }}
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
        ref={durationRef}
        type="number"
        min={1}
        value={draftDuration ?? (value.duration || '')}
        onChange={(e) => setDraftDuration(e.target.value)}
        onBlur={commitDuration}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitDuration();
            durationRef.current?.blur();
          }
        }}
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
