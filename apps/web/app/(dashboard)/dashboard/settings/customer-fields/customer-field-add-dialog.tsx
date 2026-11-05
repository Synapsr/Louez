"use client";

import { useRef } from "react";

import { LayoutTemplate } from "lucide-react";
import { useTranslations } from "next-intl";

import { CUSTOMER_FIELD_TYPES } from "@louez/types";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";

import { CustomerFieldTemplateCard } from "./customer-field-template-card";
import { CustomerFieldTypeCard } from "./customer-field-type-card";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldTemplates } from "./use-customer-field-templates";

/**
 * "Ajouter un champ" to the tab shown: its type in one click, which puts a
 * new field at the end of the list and opens its settings. The templates
 * that fit the store come below.
 */
export const CustomerFieldAddDialog = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { tab, pickerOpen, setPickerOpen, startDraft, setGalleryOpen, actions } =
    useCustomerFieldsBuilder();
  const { suggestions, isAdopted } = useCustomerFieldTemplates(tab);
  // Once a type is picked, focus belongs to the draft's name, not back to "Ajouter un champ".
  const picked = useRef(false);

  return (
    <Dialog
      open={pickerOpen}
      onOpenChange={(open) => {
        if (open) picked.current = false;
        setPickerOpen(open);
      }}
    >
      <DialogPopup className="sm:max-w-2xl" finalFocus={() => !picked.current}>
        <DialogHeader>
          <DialogTitle>{t("builder.picker.title")}</DialogTitle>
          <DialogDescription>{t(`dialog.scopes.${tab}Description`)}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CUSTOMER_FIELD_TYPES.map((type) => (
              <CustomerFieldTypeCard
                key={type}
                type={type}
                scope={tab}
                onPick={() => {
                  picked.current = true;
                  startDraft(type);
                }}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {suggestions.length > 0
                  ? t("builder.picker.suggested")
                  : t("builder.picker.templates")}
              </h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => setGalleryOpen(true)}>
                <LayoutTemplate />
                {t("builder.templates.all")}
              </Button>
            </div>
            {suggestions.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {suggestions.map((template) => (
                  <CustomerFieldTemplateCard
                    key={template.id}
                    template={template}
                    compact
                    isAdopted={isAdopted(template)}
                    isPending={actions.isAdopting}
                    onAdopt={(adopted) => {
                      actions.adoptTemplate(adopted);
                      setPickerOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
