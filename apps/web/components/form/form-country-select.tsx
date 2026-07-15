"use client";

import { useMemo } from "react";

import { useLocale } from "next-intl";

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { CountryFlag } from "@louez/ui/icons/flags";

import { getCountriesSortedByName, getCountryName, type Country } from "@/lib/utils/countries";

import { getFieldError, useFieldContext } from "@/hooks/form/form-context";

interface FormCountrySelectProps {
  label?: string;
  description?: string;
  placeholder?: string;
  locale?: string;
  countries?: readonly Country[];
  onValueChange?: (countryCode: string) => void;
}

export const FormCountrySelect = ({
  label,
  description,
  placeholder,
  locale: localeOverride,
  countries,
  onValueChange,
}: FormCountrySelectProps) => {
  const field = useFieldContext<string>();
  const activeLocale = useLocale();
  const locale = localeOverride ?? activeLocale;
  const errors = field.state.meta.errors;
  const error = errors[0];
  const errorId = `${field.name}-error`;
  const sortedCountries = useMemo(
    () =>
      countries
        ? [...countries].sort((firstCountry, secondCountry) =>
            getCountryName(firstCountry.code, locale).localeCompare(
              getCountryName(secondCountry.code, locale),
              locale,
            ),
          )
        : getCountriesSortedByName(locale),
    [countries, locale],
  );
  const selectedCountry = sortedCountries.find((country) => country.code === field.state.value);
  const selectedCountryName = selectedCountry
    ? getCountryName(selectedCountry.code, locale)
    : undefined;

  const handleValueChange = (countryCode: string | null) => {
    if (countryCode === null) return;

    field.handleChange(countryCode);
    onValueChange?.(countryCode);
  };

  return (
    <div className="grid gap-2">
      {label && (
        <Label htmlFor={field.name} data-error={errors.length > 0}>
          {label}
        </Label>
      )}
      <Select value={field.state.value || null} onValueChange={handleValueChange}>
        <SelectTrigger
          id={field.name}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={errors.length > 0}
        >
          <SelectValue placeholder={placeholder}>
            {selectedCountry && selectedCountryName && (
              <span className="inline-flex items-center gap-2">
                <CountryFlag
                  country={selectedCountry.code}
                  countryName={selectedCountryName}
                  className="h-4 w-6 shrink-0 rounded-md [&_img]:size-full [&_svg]:size-full"
                />
                <span>{selectedCountryName}</span>
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sortedCountries.map((country) => {
            const countryName = getCountryName(country.code, locale);

            return (
              <SelectItem key={country.code} value={country.code} label={countryName}>
                <span className="sr-only">{countryName}</span>
                <span aria-hidden className="inline-flex items-center gap-2">
                  <CountryFlag
                    country={country.code}
                    countryName={countryName}
                    className="h-auto w-6 "
                  />
                  <span>{countryName}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
      {error && (
        <p id={errorId} className="text-destructive text-sm">
          {getFieldError(error)}
        </p>
      )}
    </div>
  );
};
