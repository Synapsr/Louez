"use client";

import { useTranslations } from "next-intl";

import { MapPinIcon } from "@louez/ui/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";

import { InfoCallout } from "@/components/dashboard/info-callout";
import { getCountryName } from "@louez/utils/countries";

interface StoreSettingsBillingSectionProps {
  form: any;
  billingAddressSameAsStore: boolean;
  billingAddress: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
}

export function StoreSettingsBillingSection({
  form,
  billingAddressSameAsStore,
  billingAddress,
  billingCity,
  billingPostalCode,
  billingCountry,
}: StoreSettingsBillingSectionProps) {
  const t = useTranslations("dashboard.settings");

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPinIcon className="h-5 w-5 shrink-0" />
          {t("billingAddress.title")}
        </CardTitle>
        <CardDescription>{t("billingAddress.description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <form.AppField name="billingAddressSameAsStore">
          {(field: any) => (
            <field.Checkbox
              label={t("billingAddress.sameAsStore")}
              description={t("billingAddress.sameAsStoreDescription")}
            />
          )}
        </form.AppField>

        {!billingAddressSameAsStore && (
          <div className="animate-in fade-in-0 slide-in-from-top-2 min-w-0 space-y-4 duration-200">
            <form.AppField name="billingAddress">
              {(field: any) => (
                <field.Input
                  label={t("billingAddress.address")}
                  placeholder={t("billingAddress.addressPlaceholder")}
                />
              )}
            </form.AppField>

            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <form.AppField name="billingPostalCode">
                {(field: any) => (
                  <field.Input
                    label={t("billingAddress.postalCode")}
                    placeholder={t("billingAddress.postalCodePlaceholder")}
                  />
                )}
              </form.AppField>

              <form.AppField name="billingCity">
                {(field: any) => (
                  <field.Input
                    label={t("billingAddress.city")}
                    placeholder={t("billingAddress.cityPlaceholder")}
                  />
                )}
              </form.AppField>
            </div>

            <form.AppField name="billingCountry">
              {(field: any) => <field.CountrySelect label={t("billingAddress.country")} />}
            </form.AppField>

            {(billingAddress || billingCity) && (
              <div className="bg-muted/50 rounded-lg p-4 text-sm">
                <p className="text-muted-foreground mb-1 font-medium">
                  {t("billingAddress.preview")}
                </p>
                <p>{billingAddress}</p>
                {(billingPostalCode || billingCity) && (
                  <p>
                    {billingPostalCode} {billingCity}
                  </p>
                )}
                {billingCountry && <p>{getCountryName(billingCountry)}</p>}
              </div>
            )}
          </div>
        )}

        <InfoCallout>
          {billingAddressSameAsStore
            ? t("billingAddress.infoSameAddress")
            : t("billingAddress.infoDifferentAddress")}
        </InfoCallout>
      </CardContent>
    </Card>
  );
}
