"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@louez/ui";

import { InfoCallout } from "@/components/dashboard/info-callout";
import type {
  CustomerFieldTemplateGroup,
  ResolvedCustomerFieldTemplate,
} from "@/lib/customers/customer-field-templates";

import { CustomerFieldTemplateCard } from "./customer-field-template-card";

interface CustomerFieldTemplatesDialogProps {
  open: boolean;
  templates: ResolvedCustomerFieldTemplate[];
  adoptedKeys: ReadonlySet<string>;
  defaultGroup: CustomerFieldTemplateGroup;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onAdopt: (template: ResolvedCustomerFieldTemplate) => void;
}

const GROUPS: CustomerFieldTemplateGroup[] = ["general", "country", "activity"];

export const CustomerFieldTemplatesDialog = ({
  open,
  templates,
  adoptedKeys,
  defaultGroup,
  isPending,
  onOpenChange,
  onAdopt,
}: CustomerFieldTemplatesDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields.templates");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Tabs defaultValue={defaultGroup}>
            <TabsList variant="underline">
              {GROUPS.map((group) => (
                <TabsTab key={group} value={group}>
                  {t(`groups.${group}`)}
                </TabsTab>
              ))}
            </TabsList>
            {GROUPS.map((group) => (
              <TabsPanel key={group} value={group} className="pt-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {templates
                    .filter((template) => template.group === group)
                    .map((template) => (
                      <CustomerFieldTemplateCard
                        key={template.id}
                        template={template}
                        isPending={isPending}
                        isAdopted={template.fields.every(
                          (field) => field.key !== undefined && adoptedKeys.has(field.key),
                        )}
                        onAdopt={onAdopt}
                      />
                    ))}
                </div>
              </TabsPanel>
            ))}
          </Tabs>
          <InfoCallout>{t("privacyNote")}</InfoCallout>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
