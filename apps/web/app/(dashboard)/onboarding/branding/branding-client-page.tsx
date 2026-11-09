"use client";

import { useRouter } from "next/navigation";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Label, Radio, RadioGroup } from "@louez/ui";
import { cn } from "@louez/utils";

import { getFieldError } from "@/hooks/form/form-context";

import { OnboardingStepHeader } from "../_components/step-header";
import { BrandColorField } from "./brand-color-field";
import { ThemeStorefrontPreview } from "./theme-storefront-preview";
import { useBrandingStep } from "./use-branding-step";

const THEME_OPTIONS = [
  { value: "light", label: "themeLight" },
  { value: "dark", label: "themeDark" },
] as const;

export function BrandingClientPage() {
  const router = useRouter();
  const t = useTranslations("onboarding.branding");
  const tCommon = useTranslations("common");
  const {
    form,
    logoPreviewUrl,
    handleLogoSelected,
    handleLogoRemove,
    isUploading,
    isBusy,
    isNavigating,
  } = useBrandingStep();

  return (
    <>
      {/* The sentence that used to describe the step is its clearest title. */}
      <OnboardingStepHeader title={t("description")} />
      <form.AppForm>
        <form.Form className="space-y-6">
          <form.AppField name="logoUrl">
            {(field) => (
              <field.ImageUpload
                variant="dropzone"
                label={t("logo")}
                dropzoneTitle={t.rich("logoDropTitle", {
                  browse: (chunks) => (
                    <span className="text-primary underline underline-offset-3">{chunks}</span>
                  ),
                })}
                description={t("logoHelp")}
                uploadLabel={tCommon("upload")}
                removeLabel={tCommon("remove")}
                kind="logo"
                shape="square"
                previewUrl={logoPreviewUrl}
                isUploading={isUploading}
                messages={{
                  invalidType: t("logoError"),
                  tooLarge: t("logoSizeError"),
                }}
                onFileSelected={handleLogoSelected}
                onRemove={handleLogoRemove}
              />
            )}
          </form.AppField>

          <form.Field name="primaryColor">
            {(field) => (
              <div className="space-y-2">
                <Label>{t("primaryColor")}</Label>
                <BrandColorField
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.primaryColor}>
            {(primaryColor) => (
              <form.Field name="theme">
                {(field) => (
                  <div className="space-y-2">
                    <Label>{t("theme")}</Label>
                    <RadioGroup
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value as "light" | "dark")}
                      className="grid grid-cols-2 gap-3"
                    >
                      {THEME_OPTIONS.map((option) => (
                        <Label
                          key={option.value}
                          className={cn(
                            "bg-card hover:bg-muted/60 flex cursor-pointer flex-col gap-2 rounded-2xl p-1.5 shadow-[inset_0_0_0_1px_var(--color-border)] transition-[background-color,box-shadow] duration-200",
                            "group/theme has-data-checked:shadow-[inset_0_0_0_1.5px_var(--color-primary),var(--shadow-raised)]",
                          )}
                        >
                          <Radio value={option.value} className="hidden" />
                          <ThemeStorefrontPreview theme={option.value} primaryColor={primaryColor} />
                          <span className="flex items-center justify-between px-1 pb-0.5 text-sm font-medium">
                            {t(option.label)}
                            <span className="bg-primary text-primary-foreground ease-lagon flex size-4.5 scale-0 items-center justify-center rounded-full transition-transform duration-200 group-has-data-checked/theme:scale-100">
                              <Check className="size-3" strokeWidth={3} />
                            </span>
                          </span>
                        </Label>
                      ))}
                    </RadioGroup>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm font-medium">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            )}
          </form.Subscribe>

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/onboarding")}
              disabled={isBusy}
            >
              {tCommon("back")}
            </Button>
            <form.SubscribeButton className="flex-1" disabled={isBusy} isPending={isNavigating}>
              {tCommon("next")}
            </form.SubscribeButton>
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
}
