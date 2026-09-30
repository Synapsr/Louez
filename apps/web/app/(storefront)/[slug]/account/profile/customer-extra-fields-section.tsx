"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useStore } from "@/contexts/store-context";
import { orpc } from "@/lib/orpc/react";

import { CustomerExtraFieldsForm } from "./customer-extra-fields-form";
import type { CustomerExtraFieldsData } from "./customer-extra-fields.types";

interface CustomerExtraFieldsSectionProps {
  /** Read by the page, so the section is there on first paint instead of pushing the page down. */
  initialData: CustomerExtraFieldsData;
}

/**
 * "Informations complémentaires": what the store asks at checkout and lets the
 * customer keep up to date themselves, native fields (birth date, source,
 * links) and the store's own in the owner's layout. Hidden when there is
 * nothing to edit.
 */
export const CustomerExtraFieldsSection = ({ initialData }: CustomerExtraFieldsSectionProps) => {
  const t = useTranslations("storefront.account.customerFields");
  const { storeName } = useStore();
  const { data = initialData } = useQuery(
    orpc.storefront.customerFields.myValues.queryOptions({ initialData }),
  );
  const fields = data.fields.filter(
    (field) =>
      field.customerEditable &&
      (field.appliesTo === "all" || field.appliesTo === data.customerType),
  );
  const profileFields = data.profileFields.filter((field) => field.customerEditable);

  if (fields.length === 0 && profileFields.length === 0) return null;

  return (
    <section className="border-t pt-6">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("description", { store: storeName })}</p>
      <CustomerExtraFieldsForm
        profileFields={profileFields}
        profile={data.profile}
        fields={fields}
        values={data.values}
        layout={data.customerLayout}
      />
    </section>
  );
};
