"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldCollectMode } from "@louez/types";
import { Input, Label } from "@louez/ui";

import { CustomerFieldHints } from "./customer-field-hints";
import { NO_PROFILE_FIELD_HINTS } from "./util.customer-profile-fields";

interface ProfileBirthDateInputProps {
  collectMode: CustomerFieldCollectMode;
  /** DOM id of the input; the label and the error point at it. */
  id: string;
  /** ISO `yyyy-MM-dd`, "" when blank. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Already-translated error. */
  error?: string;
}

/**
 * The birth date as the storefront asks it: the browser's own date input
 * (day, month, year typed or picked), no later than today, and filled by the
 * browser's saved birthday when there is one.
 */
export const ProfileBirthDateInput = ({
  collectMode,
  id,
  value,
  onChange,
  onBlur,
  error,
}: ProfileBirthDateInputProps) => {
  const t = useTranslations("storefront.customerFields");
  const label = t("profile.birthDate");
  const hintsId = `${id}-hints`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id} data-error={Boolean(error)}>
        {collectMode === "required" ? label : t("optionalLabel", { label })}
      </Label>
      <Input
        id={id}
        type="date"
        autoComplete="bday"
        min="1900-01-01"
        max={new Date().toISOString().slice(0, 10)}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? hintsId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      <CustomerFieldHints id={hintsId} field={NO_PROFILE_FIELD_HINTS} value="" error={error} />
    </div>
  );
};
