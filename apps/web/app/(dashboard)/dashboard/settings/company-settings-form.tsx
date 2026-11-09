"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import type { StoreSettings } from "@louez/types";
import { isSupportedCurrency } from "@louez/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, toastManager } from "@louez/ui";
import { BuildingIcon } from "@louez/ui/icons";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { RootError } from "@/components/form/root-error";
import { useAppForm } from "@/hooks/form/form";
import { apiErrorKey } from "@/lib/orpc/errors";
import { orpc } from "@/lib/orpc/react";
import { SUPPORTED_CURRENCIES, getDefaultCurrencyForCountry } from "@/lib/utils/currency";
import { StoreSettingsBillingSection } from "./components/store-settings-billing-section";
import { buildCompanyUpdate } from "./util.company-settings";

/**
 * A currency Louez supports, or the one the store already uses: a store set
 * up in a currency Stripe no longer takes (HRK) keeps it until it changes.
 */
const createCompanySettingsSchema = (storedCurrency: string | null) =>
  z.object({
    country: z.string().length(2),
    currency: z
      .string()
      .refine((code) => isSupportedCurrency(code) || code === storedCurrency, "errors.invalidData"),
    billingAddressSameAsStore: z.boolean(),
    billingAddress: z.string(),
    billingCity: z.string(),
    billingPostalCode: z.string(),
    billingCountry: z.string(),
  });

interface CompanySettingsFormProps {
  settings: StoreSettings | null;
}

export const CompanySettingsForm = ({ settings }: CompanySettingsFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings");
  const tErrors = useTranslations("errors");
  const [rootError, setRootError] = useState<string | null>(null);
  const updateCompany = useMutation(orpc.dashboard.settings.updateCompany.mutationOptions());

  const defaultCountry = settings?.country || "FR";
  const storedCurrency = settings?.currency ?? null;
  const legacyCurrency =
    storedCurrency && !isSupportedCurrency(storedCurrency)
      ? { code: storedCurrency, label: t("storeSettings.currencyLegacy", { code: storedCurrency }) }
      : null;
  const companySettingsSchema = createCompanySettingsSchema(storedCurrency);
  const billingAddress = settings?.billingAddress ?? { useSameAsStore: true };

  const form = useAppForm({
    defaultValues: {
      country: defaultCountry,
      currency: settings?.currency || getDefaultCurrencyForCountry(defaultCountry),
      billingAddressSameAsStore: billingAddress.useSameAsStore,
      billingAddress: billingAddress.address ?? "",
      billingCity: billingAddress.city ?? "",
      billingPostalCode: billingAddress.postalCode ?? "",
      billingCountry: billingAddress.country ?? defaultCountry,
    },
    validators: { onSubmit: companySettingsSchema },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: async ({ value }) => {
      setRootError(null);
      try {
        await updateCompany.mutateAsync(buildCompanyUpdate(value, storedCurrency));
      } catch (error) {
        const key = apiErrorKey(error);
        setRootError(key && tErrors.has(key) ? tErrors(key) : tErrors("generic"));
        return;
      }
      toastManager.add({ title: t("settingsSaved"), type: "success" });
      form.reset();
      router.refresh();
    },
  });

  const isDirty = useStore(form.store, (state) => state.isDirty);
  const billingAddressSameAsStore = useStore(
    form.store,
    (state) => state.values.billingAddressSameAsStore,
  );
  const billingAddressValue = useStore(form.store, (state) => state.values.billingAddress);
  const billingCity = useStore(form.store, (state) => state.values.billingCity);
  const billingPostalCode = useStore(form.store, (state) => state.values.billingPostalCode);
  const billingCountry = useStore(form.store, (state) => state.values.billingCountry);

  return (
    <form.AppForm>
      <form.Form className="space-y-4 sm:space-y-6">
        <RootError error={rootError} />

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BuildingIcon className="h-5 w-5 shrink-0" />
              {t("companySettings.localization.title")}
            </CardTitle>
            <CardDescription>{t("companySettings.localization.description")}</CardDescription>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4 sm:grid-cols-2">
            <form.AppField name="country">
              {(field) => (
                <field.CountrySelect
                  label={t("storeSettings.country")}
                  // A new country brings its usual currency along; the store can still override it.
                  onValueChange={(country) =>
                    form.setFieldValue("currency", getDefaultCurrencyForCountry(country))
                  }
                />
              )}
            </form.AppField>

            <form.AppField name="currency">
              {(field) => (
                <field.CurrencySelect
                  label={t("storeSettings.currency")}
                  description={t("storeSettings.currencyDescription")}
                  currencies={SUPPORTED_CURRENCIES}
                  legacyCurrency={legacyCurrency}
                />
              )}
            </form.AppField>
          </CardContent>
        </Card>

        <StoreSettingsBillingSection
          form={form}
          billingAddressSameAsStore={billingAddressSameAsStore}
          billingAddress={billingAddressValue}
          billingCity={billingCity}
          billingPostalCode={billingPostalCode}
          billingCountry={billingCountry}
        />

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={updateCompany.isPending}
          onReset={() => form.reset()}
        />
      </form.Form>
    </form.AppForm>
  );
};
