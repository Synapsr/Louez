"use client";

import { useRef, useState } from "react";

import { LayoutTemplate, Package, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { CUSTOMER_FIELD_TYPES, type CustomerFieldScope } from "@louez/types";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

import { CustomerFieldTemplateCard } from "./customer-field-template-card";
import { CustomerFieldTypeCard } from "./customer-field-type-card";
import { type PickerRequest, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldTemplates } from "./use-customer-field-templates";

interface CustomerFieldAddDialogProps {
  request: PickerRequest;
}

/**
 * "Ajouter un champ": where it lives (on the customer record or per rented
 * unit), then its type in one click, which drops a draft in the canvas. The
 * templates that fit the store come below. Mounted per opening.
 */
export const CustomerFieldAddDialog = ({ request }: CustomerFieldAddDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { closePicker, startDraft, setGalleryOpen, actions } = useCustomerFieldsBuilder();
  const { suggestions, adoptedKeys } = useCustomerFieldTemplates();
  const [scope, setScope] = useState<CustomerFieldScope>(request.scope);
  // Once a type is picked, focus belongs to the draft's label, not back to "Ajouter un champ".
  const picked = useRef(false);
  const scopeSuggestions = suggestions.filter((template) => template.scope === scope);

  return (
    <Dialog open onOpenChange={(open) => !open && closePicker()}>
      <DialogPopup className="sm:max-w-2xl" finalFocus={() => !picked.current}>
        <DialogHeader>
          <DialogTitle>{t("builder.picker.title")}</DialogTitle>
          <DialogDescription>{t("builder.picker.description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <PanelSegmentedControl<CustomerFieldScope>
              aria-label={t("dialog.scope")}
              value={scope}
              onChange={setScope}
              options={[
                { value: "customer", label: t("dialog.scopes.customer"), icon: UserRound },
                { value: "item", label: t("dialog.scopes.item"), icon: Package },
              ]}
            />
            <p className="text-muted-foreground text-xs">
              {t(`dialog.scopes.${scope}Description`)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CUSTOMER_FIELD_TYPES.map((type) => (
              <CustomerFieldTypeCard
                key={type}
                type={type}
                scope={scope}
                onPick={() => {
                  picked.current = true;
                  startDraft({
                    scope,
                    // The section it was opened from, as long as the scope did not change.
                    section: scope === request.scope ? request.section : null,
                    type,
                  });
                }}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 border-t pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {scopeSuggestions.length > 0
                  ? t("builder.picker.suggested")
                  : t("builder.picker.templates")}
              </h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => setGalleryOpen(true)}>
                <LayoutTemplate />
                {t("builder.templates.all")}
              </Button>
            </div>
            {scopeSuggestions.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {scopeSuggestions.map((template) => (
                  <CustomerFieldTemplateCard
                    key={template.id}
                    template={template}
                    compact
                    isAdopted={template.fields.every(
                      (field) => field.key !== undefined && adoptedKeys.has(field.key),
                    )}
                    isPending={actions.isAdopting}
                    onAdopt={(adopted) => {
                      actions.adoptTemplate(adopted);
                      closePicker();
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
