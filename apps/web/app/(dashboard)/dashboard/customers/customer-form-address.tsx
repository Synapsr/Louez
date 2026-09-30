"use client";

import { useTranslations } from "next-intl";

import type { CustomerFormApi } from "./use-customer-form";

interface CustomerFormAddressProps {
  form: CustomerFormApi;
}

/** The address as one item of the layout: its line on top, postal code, city and country under it. */
export const CustomerFormAddress = ({ form }: CustomerFormAddressProps) => {
  const t = useTranslations("dashboard.customers.form");

  return (
    <div className="grid gap-4">
      <form.AppField name="address">
        {(field) => <field.Input label={t("address")} placeholder={t("addressPlaceholder")} />}
      </form.AppField>
      <div className="grid gap-4 sm:grid-cols-3">
        <form.AppField name="postalCode">
          {(field) => (
            <field.Input label={t("postalCode")} placeholder={t("postalCodePlaceholder")} />
          )}
        </form.AppField>
        <form.AppField name="city">
          {(field) => <field.Input label={t("city")} placeholder={t("cityPlaceholder")} />}
        </form.AppField>
        <form.AppField name="country">
          {(field) => <field.CountrySelect label={t("country")} placeholder={t("selectCountry")} />}
        </form.AppField>
      </div>
    </div>
  );
};
