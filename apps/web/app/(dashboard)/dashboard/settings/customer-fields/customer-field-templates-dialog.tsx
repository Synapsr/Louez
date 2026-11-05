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
import type { CustomerFieldTemplateGroup } from "@/lib/customers/customer-field-templates";

import { CustomerFieldTemplateCard } from "./customer-field-template-card";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldTemplates } from "./use-customer-field-templates";

const GROUPS: CustomerFieldTemplateGroup[] = ["general", "country", "activity"];

/** Every template of the tab shown, by group; the store's country opens first when it has one. */
export const CustomerFieldTemplatesDialog = () => {
  const t = useTranslations("dashboard.settings.customerFields.templates");
  const { tab, galleryOpen, setGalleryOpen, actions } = useCustomerFieldsBuilder();
  const { templates, suggestions, isAdopted } = useCustomerFieldTemplates(tab);
  const groups = GROUPS.filter((group) => templates.some((template) => template.group === group));
  const defaultGroup =
    suggestions.find((template) => template.group === "country")?.group ?? groups[0];

  return (
    <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
      <DialogPopup className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {/* Mounted per opening, so it starts on the right group for the tab shown. */}
          <Tabs key={tab} defaultValue={defaultGroup}>
            {groups.length > 1 && (
              <TabsList variant="underline">
                {groups.map((group) => (
                  <TabsTab key={group} value={group}>
                    {t(`groups.${group}`)}
                  </TabsTab>
                ))}
              </TabsList>
            )}
            {groups.map((group) => (
              <TabsPanel key={group} value={group} className="pt-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {templates
                    .filter((template) => template.group === group)
                    .map((template) => (
                      <CustomerFieldTemplateCard
                        key={template.id}
                        template={template}
                        isPending={actions.isAdopting}
                        isAdopted={isAdopted(template)}
                        onAdopt={actions.adoptTemplate}
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
