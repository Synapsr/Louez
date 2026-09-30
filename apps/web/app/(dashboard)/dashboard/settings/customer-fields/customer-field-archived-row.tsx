"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import type { CustomerFieldWithUsage } from "./util.customer-fields-builder";

interface CustomerFieldArchivedRowProps {
  field: CustomerFieldWithUsage;
}

/** An archived field: off every form, its values kept. One click brings it back. */
export const CustomerFieldArchivedRow = ({ field }: CustomerFieldArchivedRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly, actions, requestDelete } = useCustomerFieldsBuilder();
  const Icon = CUSTOMER_FIELD_TYPE_ICONS[field.type];

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{field.label}</p>
        <p className="text-muted-foreground truncate text-xs">
          {field.section} · {t(`dialog.scopes.${field.scope}`)}
        </p>
      </div>
      {!readOnly && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.setActive(field, true)}
          >
            <RotateCcw />
            {t("field.restore")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("builder.field.deleteLabel", { label: field.label })}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => requestDelete(field.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </li>
  );
};
