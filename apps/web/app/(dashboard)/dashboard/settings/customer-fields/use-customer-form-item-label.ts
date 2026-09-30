"use client";

import { useTranslations } from "next-intl";

import type { CustomerFormBuiltInKey } from "@louez/types";

import { getCompanyNumberLabelKey } from "@/app/(dashboard)/dashboard/customers/util.customer-form";

import { type BuilderItem, useCustomerFieldsBuilder } from "./customer-fields-builder-context";

/**
 * The name of an item, as the customer form calls it: the store's own label
 * for its fields, the form's wording for Louez's (the company number reads
 * "SIREN" in a French store, as it does on the form).
 */
export const useCustomerFormItemLabel = () => {
  const t = useTranslations("dashboard.customers");
  const tNative = useTranslations("dashboard.settings.customerFields.native");
  const { settings } = useCustomerFieldsBuilder();

  const builtInLabel = (key: CustomerFormBuiltInKey): string => {
    switch (key) {
      case "firstName":
      case "lastName":
      case "email":
      case "phone":
      case "address":
        return t(key);
      case "companyName":
      case "vatNumber":
        return t(`form.${key}`);
      case "companyNumber":
        return t(`form.${getCompanyNumberLabelKey(settings.country)}`);
      case "birthDate":
      case "acquisitionSource":
      case "socialLinks":
        return tNative(key);
    }
  };

  return (item: BuilderItem): string =>
    item.kind === "builtin" ? builtInLabel(item.key) : item.definition.label;
};
