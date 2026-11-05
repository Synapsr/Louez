"use client";

import { useTranslations } from "next-intl";

import { Input, Label } from "@louez/ui";

import { getAgeFromBirthDate } from "@/lib/customers/util.customer-age";

interface CustomerBirthDateInputProps {
  id: string;
  /** ISO `yyyy-MM-dd`, "" when blank. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  required: boolean;
  /** Already-translated message when the form refused the value. */
  error?: string;
}

/** The birth date on the team's forms, with the age it gives next to it. */
export const CustomerBirthDateInput = ({
  id,
  value,
  onChange,
  onBlur,
  required,
  error,
}: CustomerBirthDateInputProps) => {
  const t = useTranslations("dashboard.customers.form");
  const age = getAgeFromBirthDate(value);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id} data-error={Boolean(error)}>
        {required ? `${t("birthDate")} *` : t("birthDate")}
      </Label>
      <div className="flex items-center gap-3">
        <Input
          id={id}
          type="date"
          value={value}
          max={new Date().toISOString().slice(0, 10)}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        {age !== null && (
          <span className="text-muted-foreground shrink-0 text-sm">{t("ageYears", { age })}</span>
        )}
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
};
