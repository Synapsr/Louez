"use client";

import { Store, UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";

import { DisabledControlsProvider } from "@louez/ui";
import { CUSTOMER_FIELD_LIMITS } from "@louez/validations";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

import { type BuilderView, useCustomerFieldsBuilder } from "./customer-fields-builder-context";

interface CustomerFieldsToolbarProps {
  /** A phone-wide editor: the views drop their audience suffix rather than being cut. */
  compact: boolean;
}

/** Which form the canvas shows (the team's customer record, the customer's checkout), and the room left. */
export const CustomerFieldsToolbar = ({ compact }: CustomerFieldsToolbarProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { fields, view, setView } = useCustomerFieldsBuilder();
  const activeCount = fields.filter((field) => field.isActive).length;

  return (
    <div className="flex flex-col gap-2 @xl/builder:flex-row @xl/builder:items-center @xl/builder:justify-between">
      {/* Switching views changes nothing: members without `manage_settings` may too. */}
      <DisabledControlsProvider disabled={false}>
        <div className="w-full @xl/builder:max-w-md">
          <PanelSegmentedControl<BuilderView>
            aria-label={t("builder.views.label")}
            value={view}
            onChange={setView}
            options={[
              {
                value: "team",
                label: t(compact ? "builder.views.teamShort" : "builder.views.team"),
                icon: UsersRound,
              },
              {
                value: "client",
                label: t(compact ? "builder.views.clientShort" : "builder.views.client"),
                icon: Store,
              },
            ]}
          />
        </div>
      </DisabledControlsProvider>
      <p className="text-muted-foreground text-sm tabular-nums">
        {t("limits", { count: activeCount, max: CUSTOMER_FIELD_LIMITS.activeFields })}
      </p>
    </div>
  );
};
