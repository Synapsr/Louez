"use client";

import { useTranslations } from "next-intl";

import { withForm } from "@/hooks/form/form";
import type { CompanySearchResult } from "@/lib/recherche-entreprises";

import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutCompanySearchField } from "./checkout-company-search-field";

interface CheckoutBusinessFieldsProps {
  storeId: string;
  /** ISO-2 country of the store — decides the identifier wording and lookup. */
  country: string;
}

/**
 * Company identity of a business buyer. Only the company name is required:
 * SIREN and VAT stay optional so a buyer in a hurry is never blocked; the
 * invoice simply degrades to B2C.
 */
export const CheckoutBusinessFields = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutBusinessFieldsProps>(),
  render: ({ form, storeId, country }) => {
    const t = useTranslations("storefront.checkout");

    const companyNumberLabel =
      country === "FR"
        ? t("companyNumberSiren")
        : country === "BE"
          ? t("companyNumberBce")
          : t("companyNumber");

    const handleCompanySelect = (company: CompanySearchResult) => {
      form.setFieldValue("companyName", company.legalName);
      form.setFieldValue("companyNumber", company.siren);
      form.setFieldValue("vatNumber", company.vatNumber);
    };

    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
        {country === "FR" && (
          <CheckoutCompanySearchField storeId={storeId} onSelect={handleCompanySelect} />
        )}

        <form.AppField name="companyName">
          {(field) => (
            <field.Input
              label={t("companyName")}
              placeholder={t("companyNamePlaceholder")}
              autoComplete="organization"
              className="h-11 text-base sm:h-9 sm:text-sm"
            />
          )}
        </form.AppField>

        <div className="grid gap-3 sm:grid-cols-2">
          <form.AppField name="companyNumber">
            {(field) => (
              <field.Input
                label={companyNumberLabel}
                placeholder={t("companyNumberPlaceholder")}
                inputMode="numeric"
                autoComplete="off"
                className="h-11 text-base sm:h-9 sm:text-sm"
              />
            )}
          </form.AppField>
          <form.AppField name="vatNumber">
            {(field) => (
              <field.Input
                label={t("vatNumber")}
                placeholder={t("vatNumberPlaceholder")}
                autoComplete="off"
                className="h-11 text-base sm:h-9 sm:text-sm"
              />
            )}
          </form.AppField>
        </div>
      </div>
    );
  },
});
