"use client";

import { LayoutTemplate, Plus, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

import { CustomerFieldTemplateCard } from "./customer-field-template-card";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldTemplates } from "./use-customer-field-templates";

/**
 * After the Louez fields, when the store has none of its own: the templates
 * that fit it, one click each, and the way to start from a blank field.
 */
export const CustomerFieldsEmptyInvite = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly, openPicker, setGalleryOpen, actions } = useCustomerFieldsBuilder();
  const { suggestions } = useCustomerFieldTemplates();

  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl border border-dashed p-5 text-center sm:p-8">
      <DashboardIconTile icon={Sparkles} accent="primary" />
      <div className="flex max-w-md flex-col gap-1">
        <h3 className="text-lg font-semibold leading-snug">{t("builder.empty.title")}</h3>
        <p className="text-muted-foreground text-sm text-balance">
          {t("builder.empty.description")}
        </p>
      </div>
      {suggestions.length > 0 && (
        <div className="grid w-full gap-3 text-left @lg/canvas:grid-cols-2 @3xl/canvas:grid-cols-3">
          {suggestions.map((template) => (
            <CustomerFieldTemplateCard
              key={template.id}
              template={template}
              isAdopted={false}
              isPending={actions.isAdopting}
              onAdopt={actions.adoptTemplate}
            />
          ))}
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => openPicker()}>
            <Plus />
            {t("field.add")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setGalleryOpen(true)}>
            <LayoutTemplate />
            {t("builder.templates.all")}
          </Button>
        </div>
      )}
    </div>
  );
};
