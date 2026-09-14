"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";

import { withForm } from "@/hooks/form/form";
import {
  applyContactPreset,
  CONTACT_LAYOUTS,
  CONTACT_PRIMARY_CHANNELS,
  detectContactPreset,
  isContactPrimaryChannel,
} from "@/lib/storefront/util.contact-presets";

import { PanelRow } from "../panel/panel-row";
import { PanelTilePicker } from "../panel/panel-tile-picker";
import { onlineStoreFormOptions } from "../util.online-store-form";
import { ContactLayoutSketch } from "./contact-layout-sketch";

/**
 * Three ready-made contact pages as thumbnails, and the page's intro text.
 * Picking one sets the page shape and the channel toggles; once a toggle is
 * changed by hand no thumbnail is selected and a "custom" note shows, the
 * shape staying what it was.
 */
export const ContactPresetFields = withForm({
  ...onlineStoreFormOptions,
  render: ({ form }) => {
    const t = useTranslations("dashboard.settings.contactSettings.presets");
    const tSettings = useTranslations("dashboard.settings.contactSettings");
    const channels = useStore(form.store, (state) => state.values.contact.channels);
    const detected = detectContactPreset(channels);

    return (
      <>
        <div className="flex flex-col gap-2">
          <PanelTilePicker
            aria-label={t("title")}
            columns={3}
            value={detected}
            onChange={(layout) => {
              form.setFieldValue("contact.channels", applyContactPreset(channels, layout));
            }}
            options={CONTACT_LAYOUTS.map((layout) => ({
              value: layout,
              label: t(`options.${layout}.label`),
              preview: <ContactLayoutSketch layout={layout} className="rounded-lg border-0" />,
            }))}
          />
          {detected === null ? (
            <p className="text-muted-foreground text-xs">
              {t("custom", { layout: t(`options.${channels.layout}.label`) })}
            </p>
          ) : null}
        </div>

        {channels.layout === "single" ? (
          <PanelRow htmlFor="contact-primary-channel" label={t("primaryChannel")}>
            <Select
              items={CONTACT_PRIMARY_CHANNELS.map((channel) => ({
                value: channel,
                label: t(`channels.${channel}`),
              }))}
              value={channels.primaryChannel}
              onValueChange={(channel) => {
                if (typeof channel !== "string" || !isContactPrimaryChannel(channel)) return;
                form.setFieldValue(
                  "contact.channels",
                  applyContactPreset(channels, "single", channel),
                );
              }}
            >
              <SelectTrigger id="contact-primary-channel" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_PRIMARY_CHANNELS.map((channel) => (
                  <SelectItem key={channel} value={channel}>
                    {t(`channels.${channel}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PanelRow>
        ) : null}

        <form.AppField name="contact.channels.intro">
          {(field) => (
            <field.Textarea
              label={tSettings("intro.label")}
              labelHelper={tSettings("intro.description")}
              placeholder={tSettings("intro.placeholder")}
              rows={3}
              maxLength={600}
            />
          )}
        </form.AppField>
      </>
    );
  },
});
