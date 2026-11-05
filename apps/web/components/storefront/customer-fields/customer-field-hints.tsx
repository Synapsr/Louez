"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { type CustomerFieldHintField, getCustomerFieldHintKind } from "./util.customer-field-hint";

interface CustomerFieldHintsProps {
  /** Referenced by the control's `aria-describedby`. */
  id: string;
  field: CustomerFieldHintField;
  value: string;
  error?: string;
}

export const CustomerFieldHints = ({ id, field, value, error }: CustomerFieldHintsProps) => {
  const t = useTranslations("storefront.customerFields");

  switch (getCustomerFieldHintKind(field, value, error)) {
    case "error":
      return (
        <p id={id} className="text-sm text-destructive">
          {error}
        </p>
      );
    case "warning":
      return (
        <p id={id} className="flex items-start gap-1.5 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {t("suspicious")}
        </p>
      );
    case "help":
      return (
        <p id={id} className="text-sm text-muted-foreground">
          {field.helpText}
        </p>
      );
    default:
      return null;
  }
};
