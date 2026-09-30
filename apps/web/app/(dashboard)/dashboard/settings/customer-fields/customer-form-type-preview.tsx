"use client";

import { Building2, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { DisabledControlsProvider, Label } from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

/**
 * "Particulier | Professionnel", on top of the list as on the form: it
 * previews which fields each customer gets (a business adds the company
 * ones). It changes nothing, so read-only members may switch it too.
 */
export const CustomerFormTypePreview = () => {
  const t = useTranslations("dashboard.customers");
  const { customerType, setCustomerType } = useCustomerFieldsBuilder();

  return (
    <DisabledControlsProvider disabled={false}>
      <div className="flex flex-col gap-2 px-2.5 pt-1 sm:max-w-sm">
        <Label render={<p />}>{t("form.customerKind")}</Label>
        <PanelSegmentedControl
          aria-label={t("form.customerKind")}
          value={customerType}
          onChange={setCustomerType}
          options={[
            { value: "individual", label: t("customerType.individual"), icon: User },
            { value: "business", label: t("customerType.business"), icon: Building2 },
          ]}
        />
      </div>
    </DisabledControlsProvider>
  );
};
