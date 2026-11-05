"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldWidth } from "@louez/types";
import { DisabledControlsProvider, Label, useControlsDisabled } from "@louez/ui";

import { PanelGroup } from "@/components/online-store/panel/panel-group";
import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

interface CustomerFieldLayoutGroupProps {
  width: CustomerFieldWidth;
  /** The address block and the list of links always take their whole row. */
  fixed: boolean;
  onChange: (width: CustomerFieldWidth) => void;
}

/** "Mise en page": whether the field takes its whole row or shares it with its neighbour. */
export const CustomerFieldLayoutGroup = ({
  width,
  fixed,
  onChange,
}: CustomerFieldLayoutGroupProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder");
  const readOnly = useControlsDisabled();

  return (
    <PanelGroup title={t("layout.title")}>
      <div className="flex flex-col gap-2">
        <Label render={<p />}>{t("width.label")}</Label>
        <DisabledControlsProvider disabled={readOnly || fixed}>
          <PanelSegmentedControl<CustomerFieldWidth>
            aria-label={t("width.label")}
            value={width}
            onChange={onChange}
            // Narrow to wide, as on the row's own toggle.
            options={[
              { value: "half", label: t("width.half") },
              { value: "full", label: t("width.full") },
            ]}
          />
        </DisabledControlsProvider>
        <p className="text-muted-foreground text-xs">
          {fixed ? t("width.fixed") : t("width.hint")}
        </p>
      </div>
    </PanelGroup>
  );
};
