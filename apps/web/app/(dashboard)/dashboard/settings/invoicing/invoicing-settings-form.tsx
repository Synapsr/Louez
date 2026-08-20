"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastManager,
} from "@louez/ui";
import { InfoCircleIcon, WarningIcon } from "@louez/ui/icons";
import {
  createStoreLegalProfileSchema,
  isPlausibleVatNumber,
  vatRegimeValues,
} from "@louez/validations";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { RootError } from "@/components/form/root-error";
import type { CompanySearchResult } from "@/lib/recherche-entreprises";
import { getFieldError } from "@/hooks/form/form-context";
import { useAppForm } from "@/hooks/form/form";

import { upsertStoreLegalProfile, type StoreLegalProfileRecord } from "./actions";
import { CompanySearchField } from "./company-search-field";
import { InvoicingStepCard } from "./invoicing-step-card";
import { isLegalIdentityComplete, toLegalProfileFormValues } from "./util.legal-profile-form";

type InvoicingSettingsFormProps = {
  defaultCountry: string;
  profile: StoreLegalProfileRecord | null;
};

export const InvoicingSettingsForm = ({ defaultCountry, profile }: InvoicingSettingsFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.invoicing");
  const tValidation = useTranslations("validation");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();

  const [rootError, setRootError] = useState<string | null>(null);
  const [isPrefilled, setIsPrefilled] = useState(false);

  const saveMutation = useMutation({
    mutationFn: upsertStoreLegalProfile,
    onSuccess: (result, value) => {
      if (result.error) {
        setRootError(tRoot(result.error));
        return;
      }
      toastManager.add({ title: t("saved"), type: "success" });
      setIsPrefilled(false);
      form.options.defaultValues = value;
      form.reset();
      router.refresh();
    },
    onError: () => setRootError(tRoot("errors.generic")),
  });

  const form = useAppForm({
    defaultValues: toLegalProfileFormValues(profile, defaultCountry),
    validators: { onSubmit: createStoreLegalProfileSchema(tValidation) },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    onSubmit: async ({ value }) => {
      setRootError(null);
      await saveMutation.mutateAsync(value);
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);
  const country = useStore(form.store, (s) => s.values.country);
  const vatNumber = useStore(form.store, (s) => s.values.vatNumber);
  const invoicingEnabled = useStore(form.store, (s) => s.values.invoicingEnabled);
  const isIdentityComplete = useStore(form.store, (s) => isLegalIdentityComplete(s.values));

  const isFrance = country === "FR";
  const isBelgium = country === "BE";
  const showsVatWarning = !isPlausibleVatNumber(country, vatNumber);

  const companyNumberLabel = isFrance
    ? t("identity.siren")
    : isBelgium
      ? t("identity.bce")
      : t("identity.companyNumber");
  const companyNumberDescription = isFrance
    ? t("identity.sirenDescription")
    : isBelgium
      ? t("identity.bceDescription")
      : t("identity.companyNumberDescription");

  const handleCountryChange = (nextCountry: string) => {
    if (nextCountry !== "FR") {
      form.setFieldValue("siret", "");
      form.setFieldValue("rcsCity", "");
    }
  };

  const handleRegistrySelect = (company: CompanySearchResult) => {
    form.setFieldValue("legalName", company.legalName);
    if (company.legalForm) form.setFieldValue("legalForm", company.legalForm);
    form.setFieldValue("companyNumber", company.siren);
    form.setFieldValue("siret", company.siret);
    form.setFieldValue("vatNumber", company.vatNumber);
    form.setFieldValue("rcsCity", company.rcsCity);
    form.setFieldValue("registeredAddress", company.address);
    form.setFieldValue("registeredAddressComplement", company.addressComplement);
    form.setFieldValue("registeredPostalCode", company.postalCode);
    form.setFieldValue("registeredCity", company.city);
    setIsPrefilled(true);
  };

  return (
    <form.AppForm>
      <form.Form className="space-y-4 sm:space-y-6">
        <RootError error={rootError} />

        <InvoicingStepCard
          step={1}
          title={t("identity.title")}
          description={t("identity.description")}
          badge={
            <Badge variant={isIdentityComplete ? "success" : "pending"}>
              {isIdentityComplete ? t("statusComplete") : t("statusIncomplete")}
            </Badge>
          }
        >
          <form.AppField name="country">
            {(field) => (
              <field.CountrySelect
                label={t("identity.country")}
                description={t("identity.countryDescription")}
                onValueChange={handleCountryChange}
              />
            )}
          </form.AppField>

          {isFrance && <CompanySearchField onSelect={handleRegistrySelect} />}

          {isPrefilled && (
            <Alert variant="info">
              <InfoCircleIcon />
              <AlertTitle>{t("identity.search.prefilledTitle")}</AlertTitle>
              <AlertDescription>{t("identity.search.prefilledDescription")}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="legalName">
              {(field) => (
                <field.Input
                  label={t("identity.legalName")}
                  placeholder={t("identity.legalNamePlaceholder")}
                  description={t("identity.legalNameDescription")}
                />
              )}
            </form.AppField>

            <form.AppField name="legalForm">
              {(field) => (
                <field.Input
                  label={t("identity.legalForm")}
                  placeholder={t("identity.legalFormPlaceholder")}
                  description={t("identity.legalFormDescription")}
                />
              )}
            </form.AppField>

            <form.AppField name="companyNumber">
              {(field) => (
                <field.Input
                  label={companyNumberLabel}
                  description={companyNumberDescription}
                  inputMode="numeric"
                />
              )}
            </form.AppField>

            {isFrance && (
              <form.AppField name="siret">
                {(field) => (
                  <field.Input
                    label={`${t("identity.siret")} (${tCommon("optional")})`}
                    description={t("identity.siretDescription")}
                    inputMode="numeric"
                  />
                )}
              </form.AppField>
            )}

            <form.AppField name="vatNumber">
              {(field) => (
                <field.Input
                  label={`${t("identity.vatNumber")} (${tCommon("optional")})`}
                  placeholder={isBelgium ? "BE0123456789" : "FR12345678901"}
                  description={t("identity.vatNumberDescription")}
                />
              )}
            </form.AppField>

            {isFrance && (
              <form.AppField name="rcsCity">
                {(field) => (
                  <field.Input
                    label={`${t("identity.rcsCity")} (${tCommon("optional")})`}
                    description={t("identity.rcsCityDescription")}
                  />
                )}
              </form.AppField>
            )}

            <form.AppField name="shareCapital">
              {(field) => (
                <field.Input
                  label={`${t("identity.shareCapital")} (${tCommon("optional")})`}
                  description={t("identity.shareCapitalDescription")}
                  inputMode="decimal"
                />
              )}
            </form.AppField>
          </div>

          {showsVatWarning && (
            <Alert variant="warning">
              <WarningIcon />
              <AlertTitle>{t("identity.vatNumberWarningTitle")}</AlertTitle>
              <AlertDescription>
                {isBelgium ? t("identity.vatNumberWarningBe") : t("identity.vatNumberWarningFr")}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 border-t pt-6">
            <p className="text-muted-foreground text-sm font-medium">
              {t("identity.addressSection")}
            </p>
            <form.AppField name="registeredAddress">
              {(field) => (
                <field.Input
                  label={t("identity.address")}
                  placeholder={t("identity.addressPlaceholder")}
                />
              )}
            </form.AppField>
            <form.AppField name="registeredAddressComplement">
              {(field) => (
                <field.Input
                  label={`${t("identity.addressComplement")} (${tCommon("optional")})`}
                />
              )}
            </form.AppField>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="registeredPostalCode">
                {(field) => <field.Input label={t("identity.postalCode")} />}
              </form.AppField>
              <form.AppField name="registeredCity">
                {(field) => <field.Input label={t("identity.city")} />}
              </form.AppField>
            </div>
          </div>
        </InvoicingStepCard>

        <InvoicingStepCard
          step={2}
          title={t("louezInvoicing.title")}
          description={t("louezInvoicing.description")}
          muted={!isIdentityComplete}
          badge={
            invoicingEnabled && isIdentityComplete ? (
              <Badge variant="success">{t("louezInvoicing.statusActive")}</Badge>
            ) : (
              <Badge variant="tertiary">{t("louezInvoicing.statusInactive")}</Badge>
            )
          }
        >
          {!isIdentityComplete && (
            <Alert variant="info">
              <InfoCircleIcon />
              <AlertTitle>{t("louezInvoicing.lockedTitle")}</AlertTitle>
              <AlertDescription>{t("louezInvoicing.lockedDescription")}</AlertDescription>
            </Alert>
          )}

          <form.AppField name="invoicingEnabled">
            {(field) => (
              <field.Switch
                label={t("louezInvoicing.enabled")}
                description={t("louezInvoicing.enabledDescription")}
                disabled={!isIdentityComplete}
              />
            )}
          </form.AppField>

          {invoicingEnabled && (
            <div className="space-y-6 border-t pt-6">
              <form.Field name="vatRegime">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name} data-error={field.state.meta.errors.length > 0}>
                      {t("louezInvoicing.vatRegime")}
                    </Label>
                    <Select
                      items={vatRegimeValues.map((regime) => ({
                        value: regime,
                        label: t(`louezInvoicing.vatRegimeOptions.${regime}`),
                      }))}
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value)}
                    >
                      <SelectTrigger
                        id={field.name}
                        aria-invalid={field.state.meta.errors.length > 0}
                        className="sm:max-w-sm"
                      >
                        <SelectValue placeholder={t("louezInvoicing.vatRegimePlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {vatRegimeValues.map((regime) => (
                          <SelectItem key={regime} value={regime}>
                            {t(`louezInvoicing.vatRegimeOptions.${regime}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-sm">
                      {t("louezInvoicing.vatRegimeDescription")}
                    </p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.AppField name="hasVatOnDebits">
                {(field) => (
                  <field.Switch
                    label={t("louezInvoicing.hasVatOnDebits")}
                    description={t("louezInvoicing.hasVatOnDebitsDescription")}
                  />
                )}
              </form.AppField>
            </div>
          )}
        </InvoicingStepCard>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={saveMutation.isPending}
          onReset={() => form.reset()}
        />
      </form.Form>
    </form.AppForm>
  );
};
