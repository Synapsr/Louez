"use client";

import { Building2, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";

import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";

import type { CustomerFormApi } from "./use-customer-form";

interface CustomerFormTypeSwitchProps {
  form: CustomerFormApi;
}

/** "Particulier | Entreprise": on top of the form, it decides which fields follow. */
export const CustomerFormTypeSwitch = ({ form }: CustomerFormTypeSwitchProps) => {
  const t = useTranslations("dashboard.customers");

  return (
    <form.Field name="customerType">
      {(field) => (
        <div className="space-y-2 sm:max-w-sm">
          <Label>{t("form.customerKind")}</Label>
          <PanelSegmentedControl
            aria-label={t("form.customerKind")}
            value={field.state.value}
            onChange={field.handleChange}
            options={[
              { value: "individual", label: t("customerType.individual"), icon: User },
              { value: "business", label: t("customerType.business"), icon: Building2 },
            ]}
          />
        </div>
      )}
    </form.Field>
  );
};
