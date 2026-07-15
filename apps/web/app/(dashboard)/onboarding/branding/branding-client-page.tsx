"use client";

import { useRouter } from "next/navigation";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { Input } from "@louez/ui";
import { Label } from "@louez/ui";
import { Radio, RadioGroup } from "@louez/ui";

import { getFieldError } from "@/hooks/form/form-context";

import { OnboardingStepHeader } from "../_components/step-header";
import { ThemeDashboardPreview } from "./theme-dashboard-preview";
import { useBrandingStep } from "./use-branding-step";
import { cn } from "@louez/utils";

const PRESET_COLORS = [
  "#0066FF",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
];

const THEME_OPTIONS = [
  { value: "light", label: "themeLight" },
  { value: "dark", label: "themeDark" },
] as const;

export function BrandingClientPage() {
  const router = useRouter();
  const t = useTranslations("onboarding.branding");
  const tCommon = useTranslations("common");
  const { form, logoPreviewUrl, handleLogoSelected, handleLogoRemove, isUploading, isBusy } =
    useBrandingStep();

  return (
    <>
      <OnboardingStepHeader title={t("title")} description={t("description")} />
      <form.AppForm>
        <form.Form className="space-y-6">
          <form.AppField name="logoUrl">
            {(field) => (
              <field.ImageUpload
                label={t("logo")}
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
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={color}
                        className={`size-7 rounded-full transition-all ${
                          field.state.value === color
                            ? "ring-foreground ring-offset-background ring-2 ring-offset-2"
                            : "hover:scale-110"
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => form.setFieldValue("primaryColor", color)}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="size-9 shrink-0 rounded-md border"
                      style={{ backgroundColor: field.state.value }}
                    />
                    <Input
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="#0066FF"
                      className="font-mono"
                    />
                  </div>
                </div>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

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
                        "bg-muted/50 hover:bg-accent/30 has-data-checked:border-border has-data-checked:bg-muted flex cursor-pointer flex-col gap-0 rounded-xl border border-muted p-1 transition-colors",
                        "has-data-checked:outline-primary has-data-checked:outline-2 ",
                      )}
                    >
                      <Radio value={option.value} className="hidden" />
                      <ThemeDashboardPreview theme={option.value} />
                      <span className="text-sm font-medium p-1.5">{t(option.label)}</span>
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

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/onboarding")}
              disabled={isBusy}
            >
              {tCommon("back")}
            </Button>
            <form.SubscribeButton className="flex-1" disabled={isBusy}>
              {tCommon("next")}
            </form.SubscribeButton>
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
}
