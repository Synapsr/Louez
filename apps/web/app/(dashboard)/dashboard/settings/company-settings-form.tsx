"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

import type { StoreSettings } from "@louez/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, toastManager } from "@louez/ui";
import { BuildingIcon } from "@louez/ui/icons";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { RootError } from "@/components/form/root-error";
import { useAppForm } from "@/hooks/form/form";
import { SUPPORTED_CURRENCIES, getDefaultCurrencyForCountry } from "@/lib/utils/currency";

import { updateCompanySettings } from "./actions";
import { StoreSettingsBillingSection } from "./components/store-settings-billing-section";

const companySettingsSchema = z.object({
  country: z.string().length(2),
  currency: z.string().length(3),
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
  const [isPending, startTransition] = useTransition();
  const [rootError, setRootError] = useState<string | null>(null);

  const defaultCountry = settings?.country || "FR";
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
      startTransition(async () => {
        const result = await updateCompanySettings(value);
        if (result.error) {
          setRootError(result.error);
          return;
        }
        toastManager.add({ title: t("settingsSaved"), type: "success" });
        form.reset();
        router.refresh();
      });
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

        <FloatingSaveBar isDirty={isDirty} isLoading={isPending} onReset={() => form.reset()} />
      </form.Form>
    </form.AppForm>
  );
};
