"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { DisabledControlsProvider } from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";
import type { CustomerFieldSection } from "@/lib/customers/util.customer-fields";
import { DEFAULT_STORE_THEME, type StoreThemeInput } from "@/lib/theme/util.store-theme";

import { CustomerFieldsPreviewClient } from "./customer-fields-preview-client";
import { CustomerFieldsPreviewTeam } from "./customer-fields-preview-team";

type PreviewAudience = "team" | "client";

interface CustomerFieldsPreviewProps {
  sections: CustomerFieldSection<CustomerFieldDefinition>[];
  /**
   * The storefront's mode and colour, for the "Client" frame. Optional until
   * the settings page passes it; the platform theme stands in meanwhile.
   */
  theme?: StoreThemeInput | null;
}

/**
 * What the fields look like to each audience. "Équipe" is the customer form
 * of the dashboard; "Client" is the storefront checkout for a chosen product.
 */
export const CustomerFieldsPreview = ({ sections, theme }: CustomerFieldsPreviewProps) => {
  const t = useTranslations("dashboard.settings.customerFields.preview");
  const [audience, setAudience] = useState<PreviewAudience>("team");

  const customerSections = sections
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => field.scope === "customer"),
    }))
    .filter((section) => section.fields.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Switching views changes nothing: members without `manage_settings` may too. */}
      <DisabledControlsProvider disabled={false}>
        <PanelSegmentedControl<PreviewAudience>
          value={audience}
          onChange={setAudience}
          aria-label={t("title")}
          options={[
            { value: "team", label: t("audience.team") },
            { value: "client", label: t("audience.client") },
          ]}
        />
      </DisabledControlsProvider>
      <DashboardSectionCard
        title={t("title")}
        description={audience === "team" ? t("description") : t("client.description")}
      >
        {audience === "team" ? (
          <CustomerFieldsPreviewTeam sections={customerSections} />
        ) : (
          <CustomerFieldsPreviewClient
            definitions={sections.flatMap((section) => section.fields)}
            theme={theme ?? DEFAULT_STORE_THEME}
          />
        )}
      </DashboardSectionCard>
    </div>
  );
};
