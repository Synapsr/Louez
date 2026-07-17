"use client";

import * as React from "react";

import { GlobeIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Input } from "@louez/ui";
import { CountryFlag } from "@louez/ui/icons/flags";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "@louez/ui";
import { cn } from "@louez/utils";

import {
  type CountryPhoneOption,
  formatPhoneInput,
  getCountriesSortedForDisplay,
  getCountryPhoneData,
  getDefaultPhoneCountry,
  getPhoneInputCountry,
  normalizePhoneNumber,
  parsePhoneInput,
} from "@/lib/sms/phone";

const getPhoneCountryPrefix = (country: string) => `+${getCountryPhoneData(country).code}`;

export interface PhoneInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
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
  ({ className, value = "", onChange, defaultCountry = "FR", disabled, ...props }, ref) => {
    const t = useTranslations("common.phoneInput");
    const countries = React.useMemo(() => getCountriesSortedForDisplay(), []);
    const initialParsed = React.useMemo(
      () => parsePhoneInput(value, defaultCountry),
      [defaultCountry, value],
    );

    const [selectedCountry, setSelectedCountry] = React.useState<string | null>(
      initialParsed.country,
    );
    const [inputValue, setInputValue] = React.useState(
      initialParsed.displayValue || getPhoneCountryPrefix(initialParsed.country),
    );

    // Update internal state when value or defaultCountry changes externally.
    // While no number is typed, keep the default country selected so the field
    // stays aligned with the country and currency defaults from the form.
    React.useEffect(() => {
      const parsed = parsePhoneInput(value, defaultCountry);
      if (value.trim()) {
        setSelectedCountry(parsed.country);
      } else {
        setSelectedCountry(getDefaultPhoneCountry(defaultCountry));
      }
      setInputValue(parsed.displayValue || getPhoneCountryPrefix(parsed.country));
    }, [defaultCountry, value]);

    const selectedOption = React.useMemo(
      () => countries.find((country) => country.iso === selectedCountry) ?? null,
      [countries, selectedCountry],
    );

    // Build E.164 formatted number and call onChange
    const emitChange = React.useCallback(
      (country: string, national: string) => {
        const rawPhone = national.trim();
        if (!rawPhone || rawPhone === getPhoneCountryPrefix(country)) {
          onChange?.("");
          return;
        }

        onChange?.(normalizePhoneNumber(rawPhone, country) ?? rawPhone);
      },
      [onChange],
    );

    const handleCountryChange = (option: CountryPhoneOption | null) => {
      if (option === null) return;
      const country = getDefaultPhoneCountry(option.iso);
      const parsedInput = parsePhoneInput(inputValue, selectedCountry ?? defaultCountry);
      const nationalNumber = parsedInput.nationalNumber.startsWith("+")
        ? ""
        : parsedInput.nationalNumber;
      const nextInputValue = nationalNumber
        ? formatPhoneInput(`+${option.code}${nationalNumber}`, country)
        : getPhoneCountryPrefix(country);

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
        : getDefaultPhoneCountry(fallbackCountry);
      const nextInputValue = formatted || getPhoneCountryPrefix(nextCountry);

      setSelectedCountry(nextCountry);
      setInputValue(nextInputValue);
      emitChange(nextCountry ?? fallbackCountry, nextInputValue);
    };

    return (
      <div className={cn("flex gap-0 ", className)}>
        <Combobox
          items={countries}
          value={selectedOption}
          onValueChange={handleCountryChange}
          itemToStringLabel={(item) => (item ? `${item.name} +${item.code}` : "")}
          isItemEqualToValue={(a, b) => a?.iso === b?.iso}
          disabled={disabled}
        >
          <ComboboxTrigger
            aria-label={selectedOption?.name ?? t("selectCountry")}
            render={
              <Button
                variant="outline"
                className="w-12 shrink-0 relative focus-visible:z-10 justify-center px-0 font-normal rounded-r-none "
              />
            }
          >
            {selectedOption ? (
              <CountryFlag
                country={selectedOption.iso}
                countryName={selectedOption.name}
                className="h-4 w-6 shrink-0 [&_img]:size-full [&_svg]:size-full"
              />
            ) : (
              <GlobeIcon className="text-muted-foreground" />
            )}
          </ComboboxTrigger>
          <ComboboxPopup className="">
            <div className="border-b p-1.5">
              <ComboboxInput showTrigger={false} size="sm" placeholder={t("searchCountry")} />
            </div>
            <ComboboxEmpty>{t("noResults")}</ComboboxEmpty>
            <ComboboxList>
              {(country: CountryPhoneOption) => (
                <ComboboxItem key={country.iso} value={country}>
                  <span className="flex items-center gap-2">
                    <CountryFlag
                      country={country.iso}
                      countryName={country.name}
                      className="h-4 w-6 shrink-0 [&_img]:size-full [&_svg]:size-full"
                    />
                    <span className="truncate">{country.name}</span>
                    <span className="text-muted-foreground ml-auto">+{country.code}</span>
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
          className="flex-1 rounded-l-none before:rounded-l-none -ml-px focus-visible:z-10"
          {...props}
        />
      </div>
    );
  },
);
PhoneInput.displayName = "PhoneInput";

export { PhoneInput };
