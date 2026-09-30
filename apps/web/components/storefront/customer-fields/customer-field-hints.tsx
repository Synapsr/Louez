"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { hasSuspiciousIdentityValue } from "@louez/validations";

import { useStore } from "@/contexts/store-context";

import type { StorefrontCustomerField } from "./customer-fields.types";

interface CustomerFieldHintsProps {
  /** Referenced by the control's `aria-describedby`. */
  id: string;
  field: Pick<StorefrontCustomerField, "helpText" | "isSensitive" | "format">;
  value: string;
  error?: string;
}

/**
 * What sits under a custom field: the store's help text, who can read a
 * sensitive value, then the error. The lock line answers "why do they need
 * my ID number?" before the customer has to ask.
 */
export const CustomerFieldHints = ({ id, field, value, error }: CustomerFieldHintsProps) => {
  const t = useTranslations("storefront.customerFields");
  const tFields = useTranslations("dashboard.customers.fields");
  const { storeName } = useStore();
  const isSuspicious = !error && hasSuspiciousIdentityValue(field.format, value);

  if (!field.helpText && !field.isSensitive && !error && !isSuspicious) return null;

  return (
    <div id={id} className="flex flex-col gap-1">
      {field.helpText && <p className="text-sm text-muted-foreground">{field.helpText}</p>}
      {field.isSensitive && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5 shrink-0" />
          {t("sensitiveNote", { store: storeName })}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isSuspicious && (
        <p className="text-sm text-badge-warning-foreground">{tFields("suspicious")}</p>
      )}
    </div>
  );
};
