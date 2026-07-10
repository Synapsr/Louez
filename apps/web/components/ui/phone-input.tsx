'use client';

import * as React from 'react';

import { ChevronsUpDownIcon, GlobeIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Input } from '@louez/ui';
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from '@louez/ui';
import { cn } from '@louez/utils';

import {
  type CountryPhoneOption,
  formatPhoneInput,
  getCountriesSortedForDisplay,
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
 * - Searchable country combobox for all libphonenumber-js supported countries
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
    const t = useTranslations('common.phoneInput');
    const countries = React.useMemo(() => getCountriesSortedForDisplay(), []);
    const initialParsed = React.useMemo(
      () => parsePhoneInput(value, defaultCountry),
      [defaultCountry, value],
    );

    const [selectedCountry, setSelectedCountry] = React.useState<string | null>(
      value.trim() ? initialParsed.country : null,
    );
    const [inputValue, setInputValue] = React.useState(
      initialParsed.displayValue,
    );

    // Update internal state when value or defaultCountry changes externally.
    // While no number is typed, the country follows defaultCountry updates
    // (e.g. the user picking their country elsewhere in the form) but stays
    // unselected on mount so the globe placeholder shows.
    const prevDefaultCountryRef = React.useRef(defaultCountry);
    React.useEffect(() => {
      const defaultCountryChanged =
        prevDefaultCountryRef.current !== defaultCountry;
      prevDefaultCountryRef.current = defaultCountry;

      const parsed = parsePhoneInput(value, defaultCountry);
      if (value.trim()) {
        setSelectedCountry(parsed.country);
      } else if (defaultCountryChanged) {
        setSelectedCountry(getDefaultPhoneCountry(defaultCountry));
      } else {
        setSelectedCountry(null);
      }
      setInputValue(parsed.displayValue);
    }, [defaultCountry, value]);

    const selectedOption = React.useMemo(
      () => countries.find((country) => country.iso === selectedCountry) ?? null,
      [countries, selectedCountry],
    );

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

    const handleCountryChange = (option: CountryPhoneOption | null) => {
      if (option === null) return;
      const country = getDefaultPhoneCountry(option.iso);
      const nationalNumber = getPhoneNationalNumber(inputValue);
      const nextInputValue = formatPhoneInput(nationalNumber, country);

      setSelectedCountry(country);
      setInputValue(nextInputValue);
      emitChange(country, nextInputValue);
    };

    const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target.value;
      const fallbackCountry = selectedCountry ?? defaultCountry;
      const formatted = formatPhoneInput(input, fallbackCountry);
      const nextCountry = input.trim()
        ? getPhoneInputCountry(input, fallbackCountry)
        : null;

      setSelectedCountry(nextCountry);
      setInputValue(formatted);
      emitChange(nextCountry ?? fallbackCountry, input);
    };

    return (
      <div className={cn('flex gap-2', className)}>
        <Combobox
          items={countries}
          value={selectedOption}
          onValueChange={handleCountryChange}
          itemToStringLabel={(item) =>
            item ? `${item.name} +${item.code}` : ''
          }
          isItemEqualToValue={(a, b) => a?.iso === b?.iso}
          disabled={disabled}
        >
          <ComboboxTrigger
            aria-label={selectedOption?.name ?? t('selectCountry')}
            render={
              <Button
                variant="outline"
                className="w-[84px] shrink-0 justify-between px-3 font-normal"
              />
            }
          >
            {selectedOption ? (
              <span className="text-muted-foreground">
                +{selectedOption.code}
              </span>
            ) : (
              <GlobeIcon className="text-muted-foreground" />
            )}
            <ChevronsUpDownIcon className="text-muted-foreground -me-1 size-4" />
          </ComboboxTrigger>
          <ComboboxPopup className="w-72">
            <div className="border-b p-1.5">
              <ComboboxInput
                showTrigger={false}
                size="sm"
                placeholder={t('searchCountry')}
              />
            </div>
            <ComboboxEmpty>{t('noResults')}</ComboboxEmpty>
            <ComboboxList>
              {(country: CountryPhoneOption) => (
                <ComboboxItem key={country.iso} value={country}>
                  <span className="flex items-center gap-2">
                    <span className="text-base leading-none">
                      {country.flag}
                    </span>
                    <span className="truncate">{country.name}</span>
                    <span className="text-muted-foreground ml-auto">
                      +{country.code}
                    </span>
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxPopup>
        </Combobox>
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
