'use client';

import * as React from 'react';

import { Input } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { cn } from '@louez/utils';

import {
  formatPhoneInput,
  getCountriesSortedForDisplay,
  getCountryPhoneData,
  getDefaultPhoneCountry,
  getPhoneInputCountry,
  getPhoneNationalNumber,
  normalizePhoneNumber,
  parsePhoneInput,
} from '@/lib/sms/phone';

export interface PhoneInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  value?: string;
  onChange?: (value: string) => void;
  defaultCountry?: string;
}

/**
 * PhoneInput component with country selector
 *
 * Features:
 * - Country dropdown with flags for all libphonenumber-js supported countries
 * - Auto-formats national and international numbers
 * - Outputs E.164 format (+33612345678)
 * - Handles various input formats (0612..., +33612..., 0033612...)
 */
const PhoneInput = React.forwardRef<HTMLInputElement, PhoneInputProps>(
  (
    {
      className,
      value = '',
      onChange,
      defaultCountry = 'FR',
      disabled,
      ...props
    },
    ref,
  ) => {
    const countries = React.useMemo(() => getCountriesSortedForDisplay(), []);
    const initialParsed = React.useMemo(
      () => parsePhoneInput(value, defaultCountry),
      [defaultCountry, value],
    );

    const [selectedCountry, setSelectedCountry] = React.useState(
      initialParsed.country,
    );
    const [inputValue, setInputValue] = React.useState(
      initialParsed.displayValue,
    );

    // Update internal state when value changes externally
    React.useEffect(() => {
      const parsed = parsePhoneInput(value, defaultCountry);
      setSelectedCountry(parsed.country);
      setInputValue(parsed.displayValue);
    }, [defaultCountry, value]);

    const countryData = getCountryPhoneData(selectedCountry);

    // Build E.164 formatted number and call onChange
    const emitChange = React.useCallback(
      (country: string, national: string) => {
        const rawPhone = national.trim();
        if (!rawPhone) {
          onChange?.('');
          return;
        }

        onChange?.(normalizePhoneNumber(rawPhone, country) ?? rawPhone);
      },
      [onChange],
    );

    const handleCountryChange = (iso: string | null) => {
      if (iso === null) return;
      const country = getDefaultPhoneCountry(iso);
      const nationalNumber = getPhoneNationalNumber(inputValue);
      const nextInputValue = formatPhoneInput(nationalNumber, country);

      setSelectedCountry(country);
      setInputValue(nextInputValue);
      emitChange(country, nextInputValue);
    };

    const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target.value;
      const formatted = formatPhoneInput(input, selectedCountry);
      const nextCountry = getPhoneInputCountry(input, selectedCountry);

      setSelectedCountry(nextCountry);
      setInputValue(formatted);
      emitChange(nextCountry, input);
    };

    return (
      <div className={cn('flex gap-2', className)}>
        <Select
          value={selectedCountry}
          onValueChange={handleCountryChange}
          disabled={disabled}
        >
          <SelectTrigger className="w-[100px] flex-shrink-0">
            <SelectValue>
              <span className="flex items-center gap-1.5">
                <span className="text-base leading-none">
                  {countryData.flag}
                </span>
                <span className="text-muted-foreground">
                  +{countryData.code}
                </span>
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {countries.map((country) => (
              <SelectItem
                key={country.iso}
                value={country.iso}
                label={`${country.name} +${country.code}`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-base leading-none">{country.flag}</span>
                  <span>{country.name}</span>
                  <span className="text-muted-foreground ml-auto">
                    +{country.code}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          ref={ref}
          type="tel"
          inputMode="tel"
          value={inputValue}
          onChange={handleNumberChange}
          disabled={disabled}
          className="flex-1"
          {...props}
        />
      </div>
    );
  },
);
PhoneInput.displayName = 'PhoneInput';

export { PhoneInput };
