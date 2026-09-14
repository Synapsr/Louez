"use client";

import { useStore } from "@tanstack/react-form";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { Label, SelectItem } from "@louez/ui";

import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { getFieldError } from "@/hooks/form/form-context";
import { withForm } from "@/hooks/form/form";
import { localeFlags, localeNames, locales } from "@/i18n/config";

import { LogoUploadField } from "../fields/logo-upload-field";
import { PrimaryColorField } from "../fields/primary-color-field";
import { StoreUrlField } from "../fields/store-url-field";
import { PanelGroup } from "../panel/panel-group";
import { PanelRow } from "../panel/panel-row";
import { PanelSegmentedControl } from "../panel/panel-segmented-control";
import {
  MAX_TAGLINE_LENGTH,
  onlineStoreFormOptions,
  onlineStoreSectionProps,
} from "../util.online-store-form";
import type { OnlineStoreSectionProps } from "./online-store-section.types";

/** Name, tagline and description; logos and favicon; colour and mode; language and address. */
export const IdentitySection = withForm({
  ...onlineStoreFormOptions,
  props: onlineStoreSectionProps<OnlineStoreSectionProps>(),
  render: ({ form, uploads, savedValues, store }) => {
    const t = useTranslations("dashboard.onlineStore.identity");
    const tStore = useTranslations("dashboard.settings.storeSettings");
    const tAppearance = useTranslations("dashboard.settings.appearanceSettings");
    const themeMode = useStore(form.store, (state) => state.values.identity.themeMode);

    return (
      <>
        <PanelGroup title={t("presentation.title")}>
          <form.AppField name="identity.name">
            {(field) => <field.Input label={`${tStore("name")} *`} />}
          </form.AppField>

          <form.Field name="identity.tagline">
            {(field) => (
              <div className="grid min-w-0 gap-2">
                <Label
                  htmlFor={field.name}
                  helper={t("tagline.description", { max: MAX_TAGLINE_LENGTH })}
                >
                  {t("tagline.label")}
                </Label>
                <RichTextEditor
                  variant="inline"
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value)}
                  placeholder={t("tagline.placeholder")}
                />
                {field.state.meta.errors.length > 0 ? (
                  <p className="text-destructive text-sm">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                ) : null}
              </div>
            )}
          </form.Field>

          <form.Field name="identity.description">
            {(field) => (
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={field.name} helper={t("descriptionHint")}>
                  {tStore("descriptionLabel")}
                </Label>
                <RichTextEditor
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value)}
                  placeholder={tStore("descriptionPlaceholder")}
                />
                {field.state.meta.errors.length > 0 ? (
                  <p className="text-destructive text-sm">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                ) : null}
              </div>
            )}
          </form.Field>
        </PanelGroup>

        <PanelGroup title={tAppearance("branding")}>
          <div className="flex flex-col gap-3">
            <form.Field name="identity.logoUrl">
              {(field) => (
                <LogoUploadField
                  id="logo-upload"
                  label={tAppearance("logo")}
                  helper={themeMode === "dark" ? tAppearance("logoDescriptionDark") : undefined}
                  value={field.state.value}
                  savedValue={savedValues.identity.logoUrl}
                  uploads={uploads}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>

            {themeMode === "dark" ? (
              <form.Field name="identity.darkLogoUrl">
                {(field) => (
                  <LogoUploadField
                    id="dark-logo-upload"
                    label={tAppearance("darkLogo")}
                    helper={tAppearance("darkLogoDescription")}
                    value={field.state.value}
                    savedValue={savedValues.identity.darkLogoUrl}
                    uploads={uploads}
                    onChange={field.handleChange}
                    surface="white"
                  />
                )}
              </form.Field>
            ) : null}

            <form.Field name="identity.faviconUrl">
              {(field) => (
                <LogoUploadField
                  id="favicon-upload"
                  label={t("favicon.label")}
                  helper={`${t("favicon.description")} ${t("favicon.hint")}`}
                  shape="square"
                  value={field.state.value}
                  savedValue={savedValues.identity.faviconUrl}
                  uploads={uploads}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
          </div>

          <form.Field name="identity.primaryColor">
            {(field) => (
              <PrimaryColorField value={field.state.value} onChange={field.handleChange} />
            )}
          </form.Field>

          <form.Field name="identity.themeMode">
            {(field) => (
              <PanelRow label={tAppearance("theme")}>
                <PanelSegmentedControl
                  aria-label={tAppearance("theme")}
                  value={field.state.value}
                  onChange={(next) => {
                    field.handleChange(next);
                    if (next === "light") {
                      // The dark-mode logo only exists for dark stores.
                      const darkLogo = form.getFieldValue("identity.darkLogoUrl");
                      if (darkLogo && darkLogo !== savedValues.identity.darkLogoUrl) {
                        uploads.discard(darkLogo);
                      }
                      form.setFieldValue("identity.darkLogoUrl", null);
                    }
                  }}
                  options={[
                    { value: "light", label: tAppearance("themeLight"), icon: Sun },
                    { value: "dark", label: tAppearance("themeDark"), icon: Moon },
                  ]}
                />
              </PanelRow>
            )}
          </form.Field>
        </PanelGroup>

        <PanelGroup title={t("language.title")}>
          <form.AppField name="identity.locale">
            {(field) => (
              <field.Select
                label={tStore("locale")}
                labelHelper={tStore("localeDescription")}
                // An empty value is the automatic choice, which the select cannot show as an item.
                placeholder={tStore("localeAuto")}
                items={{
                  "": tStore("localeAuto"),
                  ...Object.fromEntries(
                    locales.map((locale) => [
                      locale,
                      `${localeFlags[locale]} ${localeNames[locale]}`,
                    ]),
                  ),
                }}
              >
                <SelectItem value="">{tStore("localeAuto")}</SelectItem>
                {locales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {localeFlags[locale]} {localeNames[locale]}
                  </SelectItem>
                ))}
              </field.Select>
            )}
          </form.AppField>

          <form.AppField name="contact.social.website">
            {(field) => (
              <field.Input
                label={t("website.label")}
                labelHelper={t("website.description")}
                placeholder={t("website.placeholder")}
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
              />
            )}
          </form.AppField>

          <StoreUrlField slug={store.slug} />
        </PanelGroup>
      </>
    );
  },
});
