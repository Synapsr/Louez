"use client";

import { useStore } from "@tanstack/react-form";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Separator,
} from "@louez/ui";
import { PaintIcon } from "@louez/ui/icons";

import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { withForm } from "@/hooks/form/form";

import { LogoUploadField } from "./logo-upload-field";
import { PrimaryColorField } from "./primary-color-field";
import type { PendingImageUploads } from "./use-pending-image-uploads";
import {
  type AppearanceFormValues,
  appearanceFormOptions,
  appearanceSectionProps,
} from "./util.appearance-form";

interface AppearanceBrandingSectionProps {
  uploads: PendingImageUploads;
  /** The last saved values, so only unsaved uploads get deleted. */
  savedValues: AppearanceFormValues;
}

/** Logo, dark-mode logo, primary colour and light/dark mode. */
export const AppearanceBrandingSection = withForm({
  ...appearanceFormOptions,
  props: appearanceSectionProps<AppearanceBrandingSectionProps>(),
  render: ({ form, uploads, savedValues }) => {
    const t = useTranslations("dashboard.settings.appearanceSettings");
    const themeMode = useStore(form.store, (state) => state.values.themeMode);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PaintIcon />
            {t("branding")}
          </CardTitle>
          <CardDescription>{t("brandingDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form.Field name="logoUrl">
            {(field) => (
              <LogoUploadField
                id="logo-upload"
                label={t("logo")}
                description={themeMode === "dark" ? t("logoDescriptionDark") : t("logoDescription")}
                value={field.state.value}
                savedValue={savedValues.logoUrl}
                uploads={uploads}
                onChange={field.handleChange}
              />
            )}
          </form.Field>

          {themeMode === "dark" ? (
            <form.Field name="darkLogoUrl">
              {(field) => (
                <LogoUploadField
                  id="dark-logo-upload"
                  label={t("darkLogo")}
                  description={t("darkLogoDescription")}
                  value={field.state.value}
                  savedValue={savedValues.darkLogoUrl}
                  uploads={uploads}
                  onChange={field.handleChange}
                  surface="white"
                />
              )}
            </form.Field>
          ) : null}

          <Separator />

          <form.Field name="primaryColor">
            {(field) => (
              <PrimaryColorField value={field.state.value} onChange={field.handleChange} />
            )}
          </form.Field>

          <Separator />

          <form.Field name="themeMode">
            {(field) => (
              <div className="flex flex-col gap-2">
                <div>
                  <Label>{t("theme")}</Label>
                  <p className="text-muted-foreground text-xs">{t("themeDescription")}</p>
                </div>
                <FormRadioCardGroup
                  value={field.state.value}
                  onChange={(next) => {
                    field.handleChange(next);
                    if (next === "light") {
                      // The dark-mode logo only exists for dark stores.
                      const darkLogo = form.getFieldValue("darkLogoUrl");
                      if (darkLogo && darkLogo !== savedValues.darkLogoUrl) {
                        uploads.discard(darkLogo);
                      }
                      form.setFieldValue("darkLogoUrl", null);
                    }
                  }}
                  options={[
                    { value: "light", label: t("themeLight"), icon: Sun },
                    { value: "dark", label: t("themeDark"), icon: Moon },
                  ]}
                  columns={2}
                />
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>
    );
  },
});
