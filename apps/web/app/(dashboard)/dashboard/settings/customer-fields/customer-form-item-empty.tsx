"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { CustomerFieldTemplateCard } from "./customer-field-template-card";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldTemplates } from "./use-customer-field-templates";

/**
 * "Par article loué" with no field yet: what it is for in one line, the
 * templates that fit the store, and a blank field.
 */
export const CustomerFormItemEmpty = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly, setPickerOpen, actions } = useCustomerFieldsBuilder();
  const { featured, isAdopted } = useCustomerFieldTemplates("item");

  return (
    <div className="flex flex-col gap-3 px-2.5 pb-1">
      <p className="text-muted-foreground text-sm">{t("builder.item.empty")}</p>
      {!readOnly && (
        <>
          {featured.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {featured.map((template) => (
                <CustomerFieldTemplateCard
                  key={template.id}
                  template={template}
                  compact
                  isAdopted={isAdopted(template)}
                  isPending={actions.isAdopting}
                  onAdopt={actions.adoptTemplate}
                />
              ))}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setPickerOpen(true)}
          >
            <Plus />
            {t("field.add")}
          </Button>
        </>
      )}
    </div>
  );
};
