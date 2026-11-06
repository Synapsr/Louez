"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import type { ResolvedCustomerFieldTemplate } from "@/lib/customers/customer-field-templates";

import { CustomerFieldTemplateCard } from "./customer-field-template-card";

interface CustomerFieldsSuggestionsProps {
  templates: ResolvedCustomerFieldTemplate[];
  isPending: boolean;
  onAdopt: (template: ResolvedCustomerFieldTemplate) => void;
  onBrowse: () => void;
}

/** The two or three templates that fit this store, one click away; the gallery holds the rest. */
export const CustomerFieldsSuggestions = ({
  templates,
  isPending,
  onAdopt,
  onBrowse,
}: CustomerFieldsSuggestionsProps) => {
  const t = useTranslations("dashboard.settings.customerFields.suggestions");

  return (
    <DashboardSectionCard
      title={t("title")}
      description={t("description")}
      icon={Sparkles}
      accent="primary"
      action={
        <Button type="button" variant="ghost" size="sm" onClick={onBrowse}>
          {t("browse")}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <CustomerFieldTemplateCard
            key={template.id}
            template={template}
            isAdopted={false}
            isPending={isPending}
            onAdopt={onAdopt}
          />
        ))}
      </div>
    </DashboardSectionCard>
  );
};
