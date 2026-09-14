"use client";

import Link from "next/link";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@louez/ui";
import { ExternalLinkIcon, ClockIcon } from "@louez/ui/icons";

import { AddressInput } from "@/components/ui/address-input";
import { getFieldError } from "@/hooks/form/form-context";
import { withForm } from "@/hooks/form/form";

import { ContactPresetFields } from "../fields/contact-preset-fields";
import { SocialLinksFields } from "../fields/social-links-fields";
import { PanelGroup } from "../panel/panel-group";
import { PanelRow } from "../panel/panel-row";
import { PanelSwitchRow } from "../panel/panel-switch-row";
import { onlineStoreFormOptions, onlineStoreSectionProps } from "../util.online-store-form";
import type { OnlineStoreSectionProps } from "./online-store-section.types";

const PHONE_FIELD_OPTIONS = ["hidden", "optional", "required"] as const;

/**
 * The public contact details, the contact page (template, channels, form),
 * the social profiles. Phone, SMS and email channels read the details at
 * the top, so a missing detail disables its switch, with one line saying
 * why, instead of leaving a switch that would do nothing.
 */
export const ContactSection = withForm({
  ...onlineStoreFormOptions,
  props: onlineStoreSectionProps<OnlineStoreSectionProps>(),
  render: ({ form }) => {
    const t = useTranslations("dashboard.onlineStore.contact");
    const tStore = useTranslations("dashboard.settings.storeSettings");
    const tContact = useTranslations("dashboard.settings.contactSettings");
    const tPresets = useTranslations("dashboard.settings.contactSettings.presets");
    const phone = useStore(form.store, (state) => state.values.contact.phone);
    const email = useStore(form.store, (state) => state.values.contact.email);
    const latitude = useStore(form.store, (state) => state.values.contact.latitude);
    const longitude = useStore(form.store, (state) => state.values.contact.longitude);
    const hasPhone = phone.trim() !== "";
    const hasEmail = email.trim() !== "";

    return (
      <>
        <PanelGroup title={t("details.title")}>
          <form.AppField name="contact.email">
            {(field) => (
              <field.Input
                label={tStore("email")}
                type="email"
                inputMode="email"
                placeholder="contact@example.com"
              />
            )}
          </form.AppField>
          <form.AppField name="contact.phone">
            {(field) => (
              <field.Input
                label={tStore("phone")}
                type="tel"
                inputMode="tel"
                placeholder="01 23 45 67 89"
              />
            )}
          </form.AppField>

          <form.Field name="contact.address">
            {(field) => (
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={field.name} helper={tStore("addressDescription")}>
                  {tStore("address")}
                </Label>
                <AddressInput
                  id={field.name}
                  value={field.state.value}
                  latitude={latitude}
                  longitude={longitude}
                  onChange={(address, lat, lng, displayAddress) => {
                    field.handleChange(displayAddress || address);
                    form.setFieldValue("contact.latitude", lat);
                    form.setFieldValue("contact.longitude", lng);
                  }}
                  placeholder={tStore("addressPlaceholder")}
                />
                {field.state.meta.errors.length > 0 ? (
                  <p className="text-destructive text-sm">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                ) : null}
              </div>
            )}
          </form.Field>

          <form.Field name="contact.headerPhone">
            {(field) => (
              <PanelSwitchRow
                id={field.name}
                label={t("headerPhone.label")}
                hint={hasPhone ? undefined : t("headerPhone.empty")}
                checked={field.state.value}
                onCheckedChange={field.handleChange}
                disabled={!hasPhone}
              />
            )}
          </form.Field>

          <Link
            href="/dashboard/settings/hours"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex w-fit items-center gap-2 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ClockIcon aria-hidden className="size-4" />
            {t("hours.link")}
            <ExternalLinkIcon
              aria-hidden
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </PanelGroup>

        <PanelGroup title={tPresets("title")}>
          <ContactPresetFields form={form} />
        </PanelGroup>

        <PanelGroup title={tContact("channels.title")}>
          <div className="flex flex-col gap-2">
            <form.Field name="contact.channels.phone">
              {(field) => (
                <PanelSwitchRow
                  id={field.name}
                  label={tContact("phone.label")}
                  hint={hasPhone ? undefined : tContact("phone.empty")}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                  disabled={!hasPhone}
                />
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.contact.channels.phone}>
              {(phoneEnabled) => (
                <form.Field name="contact.channels.sms">
                  {(field) => (
                    <PanelSwitchRow
                      id={field.name}
                      label={tContact("sms.label")}
                      checked={field.state.value}
                      onCheckedChange={field.handleChange}
                      disabled={!hasPhone || !phoneEnabled}
                    />
                  )}
                </form.Field>
              )}
            </form.Subscribe>

            <form.Field name="contact.channels.whatsapp">
              {(field) => (
                <PanelSwitchRow
                  id={field.name}
                  label={tContact("whatsapp.label")}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              )}
            </form.Field>

            <form.Subscribe selector={(state) => state.values.contact.channels.whatsapp}>
              {(whatsappEnabled) =>
                whatsappEnabled ? (
                  <form.AppField name="contact.channels.whatsappNumber">
                    {(numberField) => (
                      <numberField.Input
                        aria-label={tContact("whatsapp.number")}
                        type="tel"
                        inputMode="tel"
                        placeholder={phone || "+33 6 12 34 56 78"}
                      />
                    )}
                  </form.AppField>
                ) : null
              }
            </form.Subscribe>

            <form.Field name="contact.channels.email">
              {(field) => (
                <PanelSwitchRow
                  id={field.name}
                  label={tContact("email.label")}
                  hint={hasEmail ? undefined : tContact("email.empty")}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                  disabled={!hasEmail}
                />
              )}
            </form.Field>
          </div>
        </PanelGroup>

        <form.Field name="contact.channels.form">
          {(formEnabledField) => (
            <PanelGroup
              title={tContact("form.title")}
              action={
                <Switch
                  aria-label={tContact("form.label")}
                  checked={formEnabledField.state.value}
                  onCheckedChange={formEnabledField.handleChange}
                />
              }
            >
              {formEnabledField.state.value ? (
                <>
                  <form.AppField name="contact.channels.formRecipientEmail">
                    {(recipientField) => (
                      <recipientField.Input
                        label={tContact("form.recipient")}
                        type="email"
                        inputMode="email"
                        placeholder={email || "contact@example.com"}
                      />
                    )}
                  </form.AppField>

                  <form.Field name="contact.channels.formPhoneField">
                    {(phoneFieldField) => (
                      <PanelRow
                        htmlFor="contact-form-phone-field"
                        label={tContact("form.phoneField")}
                      >
                        <Select
                          items={PHONE_FIELD_OPTIONS.map((option) => ({
                            value: option,
                            label: tContact(`form.phoneFieldOptions.${option}`),
                          }))}
                          value={phoneFieldField.state.value}
                          onValueChange={(option) => {
                            const next = PHONE_FIELD_OPTIONS.find(
                              (candidate) => candidate === option,
                            );
                            if (next) phoneFieldField.handleChange(next);
                          }}
                        >
                          <SelectTrigger id="contact-form-phone-field" className="w-36 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PHONE_FIELD_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {tContact(`form.phoneFieldOptions.${option}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </PanelRow>
                    )}
                  </form.Field>
                </>
              ) : null}
            </PanelGroup>
          )}
        </form.Field>

        <PanelGroup title={t("social.title")}>
          <SocialLinksFields form={form} />
        </PanelGroup>
      </>
    );
  },
});
