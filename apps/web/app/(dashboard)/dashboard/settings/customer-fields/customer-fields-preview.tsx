"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition, CustomerFieldValues } from "@louez/types";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

import type { CustomerFieldSection } from "@/lib/customers/util.customer-fields";

interface CustomerFieldsPreviewProps {
  sections: CustomerFieldSection<CustomerFieldDefinition>[];
}

/** The real field renderer fed with throwaway values: what the team will meet on the form. */
export const CustomerFieldsPreview = ({ sections }: CustomerFieldsPreviewProps) => {
  const t = useTranslations("dashboard.settings.customerFields.preview");
  const [values, setValues] = useState<CustomerFieldValues>({});

  return (
    <DashboardSectionCard title={t("title")} description={t("description")}>
      {sections.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.name} className="space-y-3">
              <p className="text-muted-foreground text-xs font-medium uppercase">{section.name}</p>
              {section.fields.map((field) => (
                <CustomerFieldControl
                  key={field.id}
                  preview
                  definition={field}
                  value={values[field.id] ?? ""}
                  onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </DashboardSectionCard>
  );
};
