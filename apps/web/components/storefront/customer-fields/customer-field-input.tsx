"use client";

import { useTranslations } from "next-intl";

import { Checkbox, Label } from "@louez/ui";

import { CustomerFieldControl } from "./customer-field-control";
import { CustomerFieldHints } from "./customer-field-hints";
import { CustomerFieldSensitiveLock } from "./customer-field-sensitive-lock";
import type { StorefrontCustomerField } from "./customer-fields.types";
import { getCustomerFieldHintKind } from "./util.customer-field-hint";

interface CustomerFieldInputProps {
  field: StorefrontCustomerField;
  /** DOM id of the control; the label and the hints point at it. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Already-translated error. */
  error?: string;
}

/**
 * One custom field as the storefront shows it, whatever holds its value (the
 * checkout form, an account form, the owner preview). Like the rest of the
 * checkout, an optional field says so in its label and a required one does not.
 */
export const CustomerFieldInput = ({
  field,
  id,
  value,
  onChange,
  onBlur,
  error,
}: CustomerFieldInputProps) => {
  const t = useTranslations("storefront.customerFields");
  const label =
    field.collectMode === "required" ? field.label : t("optionalLabel", { label: field.label });
  const hintsId = `${id}-hints`;
  const describedBy = getCustomerFieldHintKind(field, value, error) ? hintsId : undefined;

  if (field.type === "checkbox") {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox
            id={id}
            checked={value === "true"}
            onCheckedChange={(checked) => onChange(checked ? "true" : "")}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
          />
          <Label htmlFor={id} className="text-sm font-normal">
            {label}
          </Label>
          {field.isSensitive && <CustomerFieldSensitiveLock />}
        </div>
        <CustomerFieldHints id={hintsId} field={field} value={value} error={error} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={id} data-error={Boolean(error)}>
          {label}
        </Label>
        {field.isSensitive && <CustomerFieldSensitiveLock />}
      </div>
      <CustomerFieldControl
        field={field}
        id={id}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        invalid={Boolean(error)}
        describedBy={describedBy}
      />
      <CustomerFieldHints id={hintsId} field={field} value={value} error={error} />
    </div>
  );
};
