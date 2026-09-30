"use client";

import { useTranslations } from "next-intl";

import type { CustomerFormLayoutItem } from "@louez/validations";

import { getCompanyNumberLabelKey } from "../util.customer-form";

interface CustomerRecordItemLabelProps {
  item: CustomerFormLayoutItem;
  /** The customer's country: it names the company number (SIREN, BCE…). */
  country: string | null;
}

/** The name of one item on the record card: a Louez field's own, or the store's label. */
export const CustomerRecordItemLabel = ({ item, country }: CustomerRecordItemLabelProps) => {
  const t = useTranslations("dashboard.customers");

  if (item.kind === "custom") return <>{item.definition.label}</>;

  switch (item.key) {
    case "firstName":
    case "lastName":
    case "email":
    case "phone":
    case "address":
      return <>{t(item.key)}</>;
    case "companyName":
      return <>{t("form.companyName")}</>;
    case "companyNumber":
      return <>{t(`form.${getCompanyNumberLabelKey(country)}`)}</>;
    case "vatNumber":
      return <>{t("form.vatNumber")}</>;
    case "birthDate":
      return <>{t("form.birthDate")}</>;
    case "acquisitionSource":
      return <>{t("detail.source")}</>;
    case "socialLinks":
      return <>{t("form.socialSection")}</>;
  }
};
