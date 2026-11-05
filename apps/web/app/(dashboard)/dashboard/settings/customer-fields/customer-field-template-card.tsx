"use client";

import { Check, Package, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";
import { CountryFlag } from "@louez/ui/icons/flags";

import type { ResolvedCustomerFieldTemplate } from "@/lib/customers/customer-field-templates";

import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";

interface CustomerFieldTemplateCardProps {
  template: ResolvedCustomerFieldTemplate;
  isAdopted: boolean;
  isPending: boolean;
  compact?: boolean;
  onAdopt: (template: ResolvedCustomerFieldTemplate) => void;
}

/** One template: what it is for, the fields it brings, one button to take it. */
export const CustomerFieldTemplateCard = ({
  template,
  isAdopted,
  isPending,
  compact = false,
  onAdopt,
}: CustomerFieldTemplateCardProps) => {
  const t = useTranslations("dashboard.settings.customerFields.templates");

  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start gap-3">
        {template.country && (
          <CountryFlag
            country={template.country}
            countryName={template.name}
            className="mt-0.5 h-4 w-6 shrink-0 rounded-md [&_img]:size-full [&_svg]:size-full"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold">{template.name}</p>
            {/* Its values go on each rented unit: worth knowing before adding it. */}
            {template.scope === "item" && (
              <Badge variant="secondary" size="sm">
                <Package aria-hidden />
                {t("perItem")}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {compact ? t("fieldsCount", { count: template.fields.length }) : template.description}
          </p>
        </div>
      </div>
      {!compact && (
        <ul className="text-muted-foreground flex-1 space-y-1 text-xs">
          {template.fields.map((field) => {
            const Icon = CUSTOMER_FIELD_TYPE_ICONS[field.type];
            return (
              <li key={field.key} className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{field.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        type="button"
        size="sm"
        variant={isAdopted ? "ghost" : "outline"}
        disabled={isAdopted || isPending}
        className="self-start"
        onClick={() => onAdopt(template)}
      >
        {isAdopted ? <Check className="size-4" /> : <Plus className="size-4" />}
        {isAdopted ? t("adopted") : t("adopt")}
      </Button>
    </div>
  );
};
