"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Label,
  toastManager,
} from "@louez/ui";
import { InfoCircleIcon, PercentageIcon } from "@louez/ui/icons";

import { apiErrorKey } from "@/lib/orpc/errors";
import { orpc } from "@/lib/orpc/react";
import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import type { StoreSettings, TaxSettings } from "@louez/types";
import { useAppForm } from "@/hooks/form/form";
import { RootError } from "@/components/form/root-error";
import { getFieldError } from "@/hooks/form/form-context";

const createTaxSettingsSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z.object({
    enabled: z.boolean(),
    defaultRate: z
      .number()
      .min(0, t("minValue", { min: 0 }))
      .max(100, t("maxValue", { max: 100 })),
    displayMode: z.enum(["inclusive", "exclusive"]),
    taxLabel: z.string().max(20),
    taxNumber: z.string().max(30),
  });

interface Store {
  id: string;
  settings: StoreSettings | null;
}

interface TaxSettingsFormProps {
  store: Store;
}

export function TaxSettingsForm({ store }: TaxSettingsFormProps) {
  const router = useRouter();
  const updateTaxes = useMutation(orpc.dashboard.settings.updateTaxes.mutationOptions());
  const tErrors = useTranslations("errors");
  const t = useTranslations("dashboard.settings.taxes");
  const tValidation = useTranslations("validation");
  const tCommon = useTranslations("common");

  const taxSettingsSchema = createTaxSettingsSchema(tValidation);

  const currentTax: TaxSettings = store.settings?.tax || {
    enabled: false,
    defaultRate: 20,
    displayMode: "inclusive",
    taxLabel: "",
    taxNumber: "",
  };

  const [rootError, setRootError] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: {
      enabled: currentTax.enabled,
      defaultRate: currentTax.defaultRate,
      displayMode: currentTax.displayMode,
      taxLabel: currentTax.taxLabel || "",
      taxNumber: currentTax.taxNumber || "",
    },
    validators: { onSubmit: taxSettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      try {
        await updateTaxes.mutateAsync({
          ...value,
          taxLabel: value.taxLabel || null,
          taxNumber: value.taxNumber || null,
        });
      } catch (error) {
        const key = apiErrorKey(error);
        setRootError(key && tErrors.has(key) ? tErrors(key) : tErrors("generic"));
        return;
      }
      toastManager.add({ title: t("saved"), type: "success" });
      form.options.defaultValues = value;
      form.reset();
      router.refresh();
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);
  const isEnabled = useStore(form.store, (s) => s.values.enabled);
  const displayMode = useStore(form.store, (s) => s.values.displayMode);
  const defaultRate = useStore(form.store, (s) => s.values.defaultRate);

  // Calculate example values for the hint
  const getExample = () => {
    const rate = defaultRate || 20;
    if (displayMode === "inclusive") {
      const ht = (100 / (1 + rate / 100)).toFixed(2);
      const tva = (100 - parseFloat(ht)).toFixed(2);
      return { price: "100", ht, tva, ttc: "100" };
    } else {
      const tva = ((100 * rate) / 100).toFixed(2);
      const ttc = (100 + parseFloat(tva)).toFixed(2);
      return { price: "100", ht: "100", tva, ttc };
    }
  };

  return (
    <form.AppForm>
      <form.Form className="space-y-6">
        <RootError error={rootError} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PercentageIcon className="h-5 w-5 shrink-0" />
              {t("enableSection")}
            </CardTitle>
            <CardDescription>{t("enableSectionDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enable Switch */}
            <form.AppField name="enabled">
              {(field) => (
                <field.Switch label={t("enabled")} description={t("enabledDescription")} />
              )}
            </form.AppField>

            {/* Configuration - Only when enabled */}
            {isEnabled && (
              <div className="space-y-6 border-t pt-6">
                {/* Rate + Display Mode */}
                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Default Rate */}
                  <form.Field name="defaultRate">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name}>{t("defaultRate")}</Label>
                        <InputGroup className="w-fit">
                          <InputGroupInput
                            id={field.name}
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(parseFloat(e.target.value) || 0)}
                            onBlur={field.handleBlur}
                            aria-invalid={field.state.meta.errors.length > 0}
                            className="w-24 flex-none"
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>%</InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                        <p className="text-muted-foreground text-sm">
                          {t("defaultRateDescription")}
                        </p>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">
                            {getFieldError(field.state.meta.errors[0])}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>

                  {/* Display Mode */}
                  <form.Field name="displayMode">
                    {(field) => (
                      <FormRadioCardGroup
                        value={field.state.value}
                        onChange={field.handleChange}
                        label={t("displayModeSection")}
                        options={[
                          {
                            value: "inclusive",
                            label: t("displayModeInclusive"),
                            description: t("displayModeInclusiveDescription"),
                          },
                          {
                            value: "exclusive",
                            label: t("displayModeExclusive"),
                            description: t("displayModeExclusiveDescription"),
                          },
                        ]}
                        columns={1}
                        errors={field.state.meta.errors}
                      />
                    )}
                  </form.Field>
                </div>

                {/* Example calculation */}
                <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4 text-sm">
                  <InfoCircleIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="text-muted-foreground">
                    <p>
                      {displayMode === "inclusive"
                        ? t("exampleInclusive", {
                            price: getExample().price,
                            ht: getExample().ht,
                            tva: getExample().tva,
                            rate: defaultRate || 20,
                          })
                        : t("exampleExclusive", {
                            price: getExample().price,
                            tva: getExample().tva,
                            ttc: getExample().ttc,
                            rate: defaultRate || 20,
                          })}
                    </p>
                    <p className="text-xs mt-1 opacity-75">{t("depositNoTaxInfo")}</p>
                  </div>
                </div>

                {/* Optional Settings */}
                <div className="border-t pt-6">
                  <p className="text-sm font-medium mb-4 text-muted-foreground">
                    {t("optionalSection")}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <form.AppField name="taxLabel">
                      {(field) => (
                        <field.Input
                          label={`${t("taxLabel")} (${tCommon("optional")})`}
                          placeholder={t("taxLabelPlaceholder")}
                          description={t("taxLabelDescription")}
                        />
                      )}
                    </form.AppField>

                    <form.AppField name="taxNumber">
                      {(field) => (
                        <field.Input
                          label={`${t("taxNumber")} (${tCommon("optional")})`}
                          placeholder={t("taxNumberPlaceholder")}
                          description={t("taxNumberDescription")}
                        />
                      )}
                    </form.AppField>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={updateTaxes.isPending}
          onReset={() => form.reset()}
        />
      </form.Form>
    </form.AppForm>
  );
}
