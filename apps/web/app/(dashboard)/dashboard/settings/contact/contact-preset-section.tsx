"use client";

import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Radio,
  RadioGroup,
  Select,
  Separator,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";
import { LayoutIcon } from "@louez/ui/icons";

import { withForm } from "@/hooks/form/form";
import {
  applyContactPreset,
  CONTACT_LAYOUTS,
  CONTACT_PRIMARY_CHANNELS,
  detectContactPreset,
  isContactLayout,
  isContactPrimaryChannel,
} from "@/lib/storefront/util.contact-presets";

import { ContactLayoutSketch } from "./contact-layout-sketch";
import { contactSettingsFormOptions } from "./util.contact-settings-form";

/**
 * Three ready-made pages as radio cards, and the page's intro text. Picking
 * a card sets the page shape and the channel toggles; once a toggle is
 * changed by hand the cards show none as selected and a "custom" note, the
 * shape staying what it was.
 */
export const ContactPresetSection = withForm({
  ...contactSettingsFormOptions,
  render: ({ form }) => {
    const t = useTranslations("dashboard.settings.contactSettings.presets");
    const tSettings = useTranslations("dashboard.settings.contactSettings");

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutIcon className="size-5 shrink-0" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form.Subscribe selector={(state) => state.values}>
            {(values) => {
              const detected = detectContactPreset(values);
              return (
                <>
                  <RadioGroup
                    value={detected ?? ""}
                    onValueChange={(layout) => {
                      if (typeof layout !== "string" || !isContactLayout(layout)) return;
                      form.reset(applyContactPreset(values, layout), { keepDefaultValues: true });
                    }}
                    className="grid gap-3 sm:grid-cols-3"
                  >
                    {CONTACT_LAYOUTS.map((layout) => (
                      <Label
                        key={layout}
                        className="flex cursor-pointer flex-col gap-2 rounded-lg border p-3 hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50"
                      >
                        <ContactLayoutSketch layout={layout} />
                        <span className="flex items-start gap-2">
                          <Radio value={layout} className="mt-0.5" />
                          <span className="flex flex-col gap-0.5">
                            <span className="font-semibold text-sm">
                              {t(`options.${layout}.label`)}
                            </span>
                            <span className="font-normal text-muted-foreground text-xs">
                              {t(`options.${layout}.description`)}
                            </span>
                          </span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                  {detected === null ? (
                    <p className="text-muted-foreground text-sm">
                      {t("custom", { layout: t(`options.${values.layout}.label`) })}
                    </p>
                  ) : null}
                  {values.layout === "single" ? (
                    <div className="grid gap-2 sm:max-w-sm">
                      <Label htmlFor="contact-primary-channel">{t("primaryChannel")}</Label>
                      <Select
                        items={CONTACT_PRIMARY_CHANNELS.map((channel) => ({
                          value: channel,
                          label: t(`channels.${channel}`),
                        }))}
                        value={values.primaryChannel}
                        onValueChange={(channel) => {
                          if (typeof channel !== "string" || !isContactPrimaryChannel(channel)) {
                            return;
                          }
                          form.reset(applyContactPreset(values, "single", channel), {
                            keepDefaultValues: true,
                          });
                        }}
                      >
                        <SelectTrigger id="contact-primary-channel">
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
                      <p className="text-muted-foreground text-sm">{t("primaryChannelHelp")}</p>
                    </div>
                  ) : null}
                </>
              );
            }}
          </form.Subscribe>

          <Separator />

          <form.AppField name="intro">
            {(field) => (
              <field.Textarea
                label={tSettings("intro.label")}
                description={tSettings("intro.description")}
                placeholder={tSettings("intro.placeholder")}
                rows={3}
                maxLength={600}
              />
            )}
          </form.AppField>
        </CardContent>
      </Card>
    );
  },
});
