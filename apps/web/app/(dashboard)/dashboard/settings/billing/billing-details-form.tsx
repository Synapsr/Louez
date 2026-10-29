"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import { DisabledControlsProvider, toastManager } from "@louez/ui";

import type {
  BillingDetailsField,
  BillingDetailsForm,
  BillingDetailsView,
} from "@/lib/billing-sync/pages";
import { RootError } from "@/components/form/root-error";
import { useAppForm } from "@/hooks/form/form";

import { saveBillingDetailsAction } from "./actions";

type ReadyDetails = Extract<BillingDetailsView, { kind: "ready" }>;

/**
 * The billing details on Louez's invoices to the store: legal name, billing email,
 * address and EU VAT number. They live on the store's Stripe customer, which the
 * service writes; Stripe checks the VAT number with VIES after a save.
 */
export const BillingDetailsFormView = ({
  details,
  readOnly,
}: {
  details: ReadyDetails;
  readOnly: boolean;
}) => {
  const t = useTranslations("dashboard.settings.billing.details");
  const router = useRouter();
  const [rootError, setRootError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: saveBillingDetailsAction });

  const schema = useMemo(() => {
    const required = z.string().trim().min(1, t("errors.required"));
    return z.object({
      legalName: required,
      email: z.string().trim().email(t("errors.email")),
      line1: required,
      line2: z.string(),
      postalCode: z.string(),
      city: required,
      state: z.string(),
      country: required,
      vatNumber: z.string(),
    });
  }, [t]);

  const form = useAppForm({
    defaultValues: {
      legalName: details.legalName,
      email: details.email,
      line1: details.address.line1,
      line2: details.address.line2,
      postalCode: details.address.postalCode,
      city: details.address.city,
      state: details.address.state,
      country: details.address.country || details.storeCountry || "",
      vatNumber: details.vat?.number ?? "",
    } satisfies BillingDetailsForm,
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      const result = await save.mutateAsync(value).catch(() => ({ error: "failed" as const }));
      if ("ok" in result) {
        toastManager.add({ type: "success", title: t("saved") });
        router.refresh();
        return;
      }
      if (result.error === "invalid") {
        for (const field of result.fields) refuse(field);
        return;
      }
      setRootError(result.error === "unavailable" ? t("errors.unavailable") : t("errors.failed"));
    },
  });

  /** A field the service or Stripe refused, said under the field. */
  const refuse = (field: BillingDetailsField) =>
    form.setFieldMeta(field, (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev.errorMap,
        onSubmit: field === "vatNumber" ? t("errors.vatNumber") : t("errors.refused"),
      },
    }));

  return (
    <DisabledControlsProvider disabled={readOnly}>
      <form.AppForm>
        <form.Form className="space-y-4" formName="settings.billing.details">
          <form.AppField name="legalName">
            {(field) => (
              <field.Input
                label={t("legalName")}
                description={t("legalNameHint")}
                autoComplete="organization"
              />
            )}
          </form.AppField>
          <form.AppField name="email">
            {(field) => (
              <field.Input
                label={t("email")}
                description={t("emailHint")}
                type="email"
                autoComplete="email"
              />
            )}
          </form.AppField>
          <form.AppField name="line1">
            {(field) => <field.Input label={t("line1")} autoComplete="address-line1" />}
          </form.AppField>
          <form.AppField name="line2">
            {(field) => <field.Input label={t("line2")} autoComplete="address-line2" />}
          </form.AppField>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="postalCode">
              {(field) => <field.Input label={t("postalCode")} autoComplete="postal-code" />}
            </form.AppField>
            <form.AppField name="city">
              {(field) => <field.Input label={t("city")} autoComplete="address-level2" />}
            </form.AppField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="state">
              {(field) => <field.Input label={t("state")} autoComplete="address-level1" />}
            </form.AppField>
            <form.AppField name="country">
              {(field) => (
                <field.CountrySelect label={t("country")} placeholder={t("countryPlaceholder")} />
              )}
            </form.AppField>
          </div>
          <form.AppField name="vatNumber">
            {(field) => (
              <field.Input
                label={t("vatNumber")}
                description={
                  details.vat && field.state.value === details.vat.number
                    ? t(`vat.${details.vat.check}`)
                    : t("vatNumberHint")
                }
              />
            )}
          </form.AppField>

          <RootError error={rootError} />
          {!readOnly && <form.SubscribeButton>{t("save")}</form.SubscribeButton>}
        </form.Form>
      </form.AppForm>
    </DisabledControlsProvider>
  );
};
