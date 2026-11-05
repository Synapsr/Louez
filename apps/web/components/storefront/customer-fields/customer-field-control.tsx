"use client";

import { useTranslations } from "next-intl";

import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@louez/ui";

import { PhoneInput } from "@/components/ui/phone-input";

import type { StorefrontCustomerField } from "./customer-fields.types";

/** Longest value the checkout accepts (`customerFieldValuesSchema`). */
const VALUE_MAX_LENGTH = 2000;

interface CustomerFieldControlProps {
  field: Pick<StorefrontCustomerField, "type" | "options" | "unit" | "isSensitive">;
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  invalid: boolean;
  describedBy?: string;
}

const getInputType = (type: StorefrontCustomerField["type"]) =>
  type === "email" || type === "url" || type === "date" ? type : "text";

const getInputMode = (type: StorefrontCustomerField["type"]) => {
  if (type === "number") return "decimal";
  if (type === "email" || type === "url") return type;
  return undefined;
};

/**
 * The control of one custom field, checkboxes aside. Native types where the
 * phone keyboard helps (decimal pad, date wheel, e-mail keyboard); a sensitive
 * value is hidden from session replays.
 */
export const CustomerFieldControl = ({
  field,
  id,
  value,
  onChange,
  onBlur,
  invalid,
  describedBy,
}: CustomerFieldControlProps) => {
  const t = useTranslations("dashboard.customers.fields");
  const sensitive = field.isSensitive ? { "data-openreplay-obscured": true } : {};

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          rows={3}
          value={value}
          maxLength={VALUE_MAX_LENGTH}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="text-base sm:text-sm"
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          {...sensitive}
        />
      );
    case "select": {
      const options = field.options ?? [];
      return (
        <Select
          items={options.map((option) => ({ value: option, label: option }))}
          value={value || null}
          onValueChange={(next) => onChange(next ?? "")}
        >
          <SelectTrigger id={id} aria-invalid={invalid} aria-describedby={describedBy}>
            <SelectValue placeholder={t("selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option} label={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "phone":
      return (
        <PhoneInput
          id={id}
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={onChange}
          onBlur={onBlur}
          {...sensitive}
        />
      );
    default:
      return (
        <div className="relative">
          <Input
            id={id}
            value={value}
            type={getInputType(field.type)}
            inputMode={getInputMode(field.type)}
            autoComplete="off"
            maxLength={VALUE_MAX_LENGTH}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={field.unit ? "pr-12" : undefined}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            {...sensitive}
          />
          {field.unit && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              {field.unit}
            </span>
          )}
        </div>
      );
  }
};
