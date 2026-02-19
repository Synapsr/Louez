'use client';

import { useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

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

  const inputClasses =
    'border-input dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 flex h-9 rounded-md border bg-transparent shadow-xs has-[:focus]:ring-[3px]';
  const numberInputClasses =
    'min-w-0 flex-1 [appearance:textfield] bg-transparent px-3 text-base outline-none md:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  const inlineSelectClasses =
    'border-input bg-muted/50 text-muted-foreground h-full cursor-pointer border-l px-2.5 text-sm outline-none';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className={cn(inputClasses, 'w-32')}>
        <input
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
          placeholder="0.00"
          className={cn(numberInputClasses, 'rounded-l-md')}
        />
        <span className="border-input bg-muted/50 text-muted-foreground flex items-center rounded-r-md border-l px-2.5 text-sm">
          {symbol}
        </span>
      </div>

      <span className="text-muted-foreground text-sm">/</span>

      <div className={cn(inputClasses, 'w-40')}>
        <input
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
          className={cn(numberInputClasses, 'rounded-l-md')}
        />
        <select
          value={value.unit}
          onChange={(e) => {
            handleChange({
              ...value,
              unit: e.target.value as DurationUnit,
            });
          }}
          disabled={disabled}
          className={cn(inlineSelectClasses, 'rounded-r-md')}
        >
          {DURATION_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {getUnitLabel(unit)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
