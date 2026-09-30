"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition, CustomerFieldValues } from "@louez/types";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";
import type { CustomerFieldSection } from "@/lib/customers/util.customer-fields";

interface CustomerFieldsPreviewTeamProps {
  /** Customer-scope sections only: item fields never sit on the customer record. */
  sections: CustomerFieldSection<CustomerFieldDefinition>[];
}

/** The real field renderer fed with throwaway values: what the team meets on the customer form. */
export const CustomerFieldsPreviewTeam = ({ sections }: CustomerFieldsPreviewTeamProps) => {
  const t = useTranslations("dashboard.settings.customerFields.preview");
  const [values, setValues] = useState<CustomerFieldValues>({});

  if (sections.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return (
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
  );
};
