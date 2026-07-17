"use client";

import { useRouter } from "next/navigation";

import { useTranslations } from "next-intl";

import { Button, Label } from "@louez/ui";

import { StoreSwitcher } from "@/components/dashboard/store-switcher";
import { FormStoreNameSlug } from "@/components/form/form-store-name-slug";
import { AddressInput } from "@/components/ui/address-input";

import { getFieldError } from "@/hooks/form/form-context";

import { env } from "@/env";

import { OnboardingStepHeader } from "./_components/step-header";
import { useOnboardingSteps } from "./_lib/steps-context";
import { useStoreStep } from "./use-store-step";

interface StoreWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: "owner" | "member" | "platform_admin";
}

interface StoreOnboardingClientPageProps {
  stores: StoreWithRole[];
  currentStoreId: string | null;
  editingStoreId: string | null;
  initialCountry: string;
  shouldDetectBrowserCountry: boolean;
}

export function StoreOnboardingClientPage({
  stores,
  currentStoreId,
  editingStoreId,
  initialCountry,
  shouldDetectBrowserCountry,
}: StoreOnboardingClientPageProps) {
  const router = useRouter();
  const t = useTranslations("onboarding.store");
  const tCommon = useTranslations("common");
  const { form, clearSlugSubmitError, handleCountrySelection, country, latitude, longitude } =
    useStoreStep({ editingStoreId, initialCountry, shouldDetectBrowserCountry });

  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
  const canSwitchAccount = Boolean(currentStoreId && stores.length > 0);
  // Back to profile only when it is part of this flow (first onboarding):
  // the step list is snapshotted per page load, so it still includes the
  // profile step right after completing it — exactly when "go fix a typo"
  // matters — and excludes it on later store creations.
  const hasProfileStep = useOnboardingSteps().some((step) => step.key === "profile");

  return (
    <>
      {canSwitchAccount && currentStoreId && (
        <div className="mb-6">
          <StoreSwitcher stores={stores} currentStoreId={currentStoreId} />
        </div>
      )}
      <OnboardingStepHeader title={t("title")} description={t("description")} />
      <form.AppForm>
        <form.Form className="space-y-6">
          {/* Store Name + Slug Preview */}
          <form.Field name="name">
            {(nameField) => (
              <form.Field name="slug">
                {(slugField) => (
                  <FormStoreNameSlug
                    nameValue={nameField.state.value}
                    nameErrors={nameField.state.meta.errors}
                    slugValue={slugField.state.value}
                    slugErrors={slugField.state.meta.errors}
                    onNameChange={nameField.handleChange}
                    onNameBlur={nameField.handleBlur}
                    onSlugChange={(value) => {
                      clearSlugSubmitError();
                      slugField.handleChange(value);
                    }}
                    label={t("name")}
                    slugLabel={t("slug")}
                    namePlaceholder={t("namePlaceholder")}
                    slugPlaceholder={t("slugPlaceholder")}
                    domain={domain}
                    resetAriaLabel={t("resetSlug")}
                  />
                )}
              </form.Field>
            )}
          </form.Field>

          {/* Location & Contact Section */}
          <div className="space-y-4 border-t pt-4">
            {/* <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4" />
              {t('locationSection')}
            </div> */}
            <div className="grid grid-cols-2 gap-4">
              <form.AppField name="country">
                {(field) => (
                  <field.CountrySelect
                    label={t("country")}
                    placeholder={t("countryPlaceholder")}
                    onValueChange={handleCountrySelection}
                  />
                )}
              </form.AppField>

              <form.AppField name="currency">
                {(field) => (
                  <field.CurrencySelect
                    label={t("currency")}
                    placeholder={t("currencyPlaceholder")}
                  />
                )}
              </form.AppField>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <form.AppField name="email">
                {(field) => (
                  <field.Input
                    label={t("contactEmail")}
                    type="email"
                    placeholder={t("emailPlaceholder")}
                  />
                )}
              </form.AppField>

              <form.AppField name="phone">
                {(field) => (
                  <field.PhoneInput
                    label={t("contactPhone")}
                    defaultCountry={country}
                    placeholder={t("phonePlaceholder")}
                  />
                )}
              </form.AppField>
            </div>
            <form.Field name="address">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="address">{t("address")}</Label>
                  <AddressInput
                    value={field.state.value || ""}
                    latitude={latitude}
                    longitude={longitude}
                    onChange={(address, lat, lng) => {
                      field.handleChange(address);
                      form.setFieldValue("latitude", lat);
                      form.setFieldValue("longitude", lng);
                    }}
                    placeholder={t("addressPlaceholder")}
                  />
                  <p className="text-muted-foreground text-sm">{t("addressHelp")}</p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          </div>

          <div className="mt-2 flex items-center gap-3">
            {hasProfileStep && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push("/onboarding/profile")}
              >
                {tCommon("back")}
              </Button>
            )}
            <form.SubscribeButton className="flex-1">{tCommon("next")}</form.SubscribeButton>
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
}
