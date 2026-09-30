"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldType } from "@louez/types";
import { Button } from "@louez/ui";

import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";

interface CustomerFieldAskRowProps {
  label: string;
  /** Under the label: the field's section, or "Champ Louez". */
  detail: string;
  type: CustomerFieldType;
  asked: boolean;
  onAsk: () => void;
}

/** A field the checkout could ask, a store field or a Louez one: one button asks it, then says so. */
export const CustomerFieldAskRow = ({
  label,
  detail,
  type,
  asked,
  onAsk,
}: CustomerFieldAskRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.client");
  const Icon = CUSTOMER_FIELD_TYPE_ICONS[type];

  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-muted-foreground truncate text-xs">{detail}</p>
      </div>
      <Button
        type="button"
        size="xs"
        variant={asked ? "ghost" : "outline"}
        disabled={asked}
        aria-label={asked ? undefined : t("askField", { label })}
        onClick={onAsk}
      >
        {asked && <Check />}
        {asked ? t("asked") : t("askButton")}
      </Button>
    </li>
  );
};
