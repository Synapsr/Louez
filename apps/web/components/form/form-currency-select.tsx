"use client";

import { useMemo } from "react";

import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { CountryFlag } from "@louez/ui/icons/flags";

import {
  getCurrenciesSortedByName,
  getCurrencyFlagCountry,
  type Currency,
} from "@/lib/utils/currency";

import { getFieldError, useFieldContext } from "@/hooks/form/form-context";

interface FormCurrencySelectProps {
  label?: string;
  description?: string;
  placeholder?: string;
  currencies?: readonly Currency[];
  onValueChange?: (currencyCode: string) => void;
}

export const FormCurrencySelect = ({
  label,
  description,
  placeholder,
  currencies,
  onValueChange,
}: FormCurrencySelectProps) => {
  const field = useFieldContext<string>();
  const errors = field.state.meta.errors;
  const error = errors[0];
  const errorId = `${field.name}-error`;
  const sortedCurrencies = useMemo(
    () =>
      currencies
        ? [...currencies].sort((firstCurrency, secondCurrency) =>
            firstCurrency.name.localeCompare(secondCurrency.name),
          )
        : getCurrenciesSortedByName(),
    [currencies],
  );
  const selectedCurrency = sortedCurrencies.find((currency) => currency.code === field.state.value);

  const handleValueChange = (currencyCode: string | null) => {
    if (currencyCode === null) return;

    field.handleChange(currencyCode);
    onValueChange?.(currencyCode);
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
            {selectedCurrency && (
              <span className="inline-flex items-center gap-2">
                <CountryFlag
                  country={getCurrencyFlagCountry(selectedCurrency)}
                  countryName={selectedCurrency.name}
                  className="h-4 w-6 shrink-0 [&_img]:size-full [&_svg]:size-full"
                />
                <span>{selectedCurrency.code}</span>
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sortedCurrencies.map((currency) => (
            <SelectItem
              key={currency.code}
              value={currency.code}
              label={`${currency.code} ${currency.name}`}
              className="min-h-14 py-2"
            >
              <span className="sr-only">
                {currency.code} {currency.name}
              </span>
              <span aria-hidden className="flex items-center gap-2">
                <CountryFlag
                  country={getCurrencyFlagCountry(currency)}
                  countryName={currency.name}
                  className="h-auto w-9 shrink-0 rounded-md [&_img]:size-full [&_svg]:size-full"
                />
                <span className="grid">
                  <span className=" text-xs font-medium">{currency.code}</span>
                  <span className="text-[10px] text-muted-foreground">{currency.name}</span>
                </span>
              </span>
            </SelectItem>
          ))}
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
