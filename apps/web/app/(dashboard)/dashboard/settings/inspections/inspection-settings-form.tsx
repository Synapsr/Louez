"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { PenLine } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  toastManager,
} from "@louez/ui";
import { CameraIcon, ClipboardIcon, CogIcon, FileCheckIcon, FileTextIcon } from "@louez/ui/icons";
import { useStore } from "@tanstack/react-form";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { updateInspectionSettings } from "./actions";
import type { StoreSettings, InspectionSettings } from "@louez/types";
import { useAppForm } from "@/hooks/form/form";
import { RootError } from "@/components/form/root-error";
import { getFieldError } from "@/hooks/form/form-context";

const INSPECTION_MODES = ["optional", "recommended", "required"] as const;

const createInspectionSettingsSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z.object({
    enabled: z.boolean(),
    mode: z.enum(INSPECTION_MODES),
    requireCustomerSignature: z.boolean(),
    autoGeneratePdf: z.boolean(),
    maxPhotosPerItem: z
      .number()
      .min(1, t("minValue", { min: 1 }))
      .max(50, t("maxValue", { max: 50 })),
  });

interface Store {
  id: string;
  settings: StoreSettings | null;
}

interface InspectionSettingsFormProps {
  store: Store;
  readOnly?: boolean;
}

export function InspectionSettingsForm({ store, readOnly = false }: InspectionSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("dashboard.settings.inspection");
  const tValidation = useTranslations("validation");

  const inspectionSettingsSchema = createInspectionSettingsSchema(tValidation);

  const currentInspection: InspectionSettings = store.settings?.inspection || {
    enabled: false,
    mode: "optional",
    requireCustomerSignature: true,
    autoGeneratePdf: true,
    maxPhotosPerItem: 10,
  };

  const [rootError, setRootError] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: {
      enabled: currentInspection.enabled,
      mode: currentInspection.mode || "optional",
      requireCustomerSignature: currentInspection.requireCustomerSignature,
      autoGeneratePdf: currentInspection.autoGeneratePdf,
      maxPhotosPerItem: currentInspection.maxPhotosPerItem,
    },
    validators: { onSubmit: inspectionSettingsSchema },
    onSubmit: async ({ value }) => {
      if (readOnly) return;
      setRootError(null);
      startTransition(async () => {
        const result = await updateInspectionSettings(value);
        if (result.error) {
          setRootError(result.error);
          return;
        }
        toastManager.add({ title: t("saved"), type: "success" });
        form.options.defaultValues = value;
        form.reset();
        router.refresh();
      });
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);
  const isEnabled = useStore(form.store, (s) => s.values.enabled);
  return (
    <form.AppForm>
      <form.Form
        className="space-y-6"
        {...(readOnly
          ? {
              onSubmit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                event.stopPropagation();
              },
            }
          : {})}
      >
        <RootError error={rootError} />

        {/* Enable Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardIcon className="h-5 w-5 shrink-0" />
              {t("enableSection")}
            </CardTitle>
            <CardDescription>{t("enableSectionDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.AppField name="enabled">
              {(field) => (
                <field.Switch label={t("enabled")} description={t("enabledDescription")} />
              )}
            </form.AppField>
          </CardContent>
        </Card>

        {/* Mode Section */}
        {isEnabled && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CogIcon className="h-5 w-5 shrink-0" />
                {t("modeSection")}
              </CardTitle>
            </CardHeader>
            <CardContent data-demo-target="inspection-mode">
              <form.Field name="mode">
                {(field) => (
                  <FormRadioCardGroup
                    value={field.state.value}
                    onChange={field.handleChange}
                    options={[
                      {
                        value: "optional",
                        label: t("modeOptional"),
                        description: t("modeOptionalDescription"),
                      },
                      {
                        value: "recommended",
                        label: t("modeRecommended"),
                        description: t("modeRecommendedDescription"),
                      },
                      {
                        value: "required",
                        label: t("modeRequired"),
                        description: t("modeRequiredDescription"),
                      },
                    ]}
                    columns={1}
                    errors={field.state.meta.errors}
                  />
                )}
              </form.Field>
            </CardContent>
          </Card>
        )}

        {/* Signature & PDF Section */}
        {isEnabled && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheckIcon className="h-5 w-5 shrink-0" />
                {t("signatureSection")}
              </CardTitle>
            </CardHeader>
            <CardContent data-demo-target="inspection-signature-setting" className="space-y-4">
              <form.AppField name="requireCustomerSignature">
                {(field) => (
                  <field.Switch
                    label={t("requireCustomerSignature")}
                    description={t("requireCustomerSignatureDescription")}
                    icon={<PenLine className="size-5" />}
                  />
                )}
              </form.AppField>

              <form.AppField name="autoGeneratePdf">
                {(field) => (
                  <field.Switch
                    label={t("autoGeneratePdf")}
                    description={t("autoGeneratePdfDescription")}
                    icon={<FileTextIcon className="size-5" />}
                  />
                )}
              </form.AppField>
            </CardContent>
          </Card>
        )}

        {/* Photos Section */}
        {isEnabled && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CameraIcon className="h-5 w-5 shrink-0" />
                {t("maxPhotosPerItem")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form.Field name="maxPhotosPerItem">
                {(field) => (
                  <div className="grid gap-2">
                    <p className="text-muted-foreground text-sm mb-4">
                      {t("maxPhotosPerItemDescription")}
                    </p>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      className="w-32"
                      id={field.name}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 1)}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </CardContent>
          </Card>
        )}

        <FloatingSaveBar isDirty={isDirty} isLoading={isPending} onReset={() => form.reset()} />
      </form.Form>
    </form.AppForm>
  );
}
