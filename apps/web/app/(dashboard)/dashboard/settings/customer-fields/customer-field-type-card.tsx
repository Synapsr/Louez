"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldScope, CustomerFieldType } from "@louez/types";

import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";

interface CustomerFieldTypeCardProps {
  type: CustomerFieldType;
  /** The example reads differently for a customer and for a rented unit. */
  scope: CustomerFieldScope;
  onPick: () => void;
}

/** One field type in the picker: its icon, its name and what it is typically used for. */
export const CustomerFieldTypeCard = ({ type, scope, onPick }: CustomerFieldTypeCardProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const Icon = CUSTOMER_FIELD_TYPE_ICONS[type];

  return (
    <button
      type="button"
      className="hover:border-primary/48 hover:bg-accent/50 focus-visible:ring-ring flex min-w-0 items-start gap-3 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2"
      onClick={onPick}
    >
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">{t(`dialog.types.${type}`)}</span>
        <span className="text-muted-foreground text-xs">
          {t(`builder.picker.examples.${scope}.${type}`)}
        </span>
      </span>
    </button>
  );
};
