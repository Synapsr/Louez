"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Slider, Switch } from "@louez/ui";

import { withForm } from "@/hooks/form/form";

import { HeroImagesField } from "../fields/hero-images-field";
import { HeroLayoutField } from "../fields/hero-layout-field";
import { HeroPositionField } from "../fields/hero-position-field";
import { PanelGroup } from "../panel/panel-group";
import { PanelSegmentedControl } from "../panel/panel-segmented-control";
import { PanelSwitchRow } from "../panel/panel-switch-row";
import {
  MAX_ANNOUNCEMENT_LENGTH,
  onlineStoreFormOptions,
  onlineStoreSectionProps,
} from "../util.online-store-form";
import type { OnlineStoreSectionProps } from "./online-store-section.types";

/**
 * The home hero, the announcement line, the catalog's first screen, the
 * optional blocks. Layout and text position only mean something on a photo,
 * so they show once the hero has one.
 */
export const HomeSection = withForm({
  ...onlineStoreFormOptions,
  props: onlineStoreSectionProps<OnlineStoreSectionProps>(),
  render: ({ form, uploads, savedValues }) => {
    const t = useTranslations("dashboard.onlineStore.home");
    const tCommon = useTranslations("common");
    const tAppearance = useTranslations("dashboard.settings.appearanceSettings");
    const hasHeroImages = useStore(form.store, (state) => state.values.home.heroImages.length > 0);
    const heroLayout = useStore(form.store, (state) => state.values.home.heroLayout);
    const heroAlign = useStore(form.store, (state) => state.values.home.heroAlign);
    const heroVerticalAlign = useStore(form.store, (state) => state.values.home.heroVerticalAlign);

    return (
      <>
        <PanelGroup title={t("header")}>
          <form.Field name="home.heroImages">
            {(field) => (
              <HeroImagesField
                value={field.state.value}
                savedValue={savedValues.home.heroImages}
                uploads={uploads}
                onChange={field.handleChange}
              />
            )}
          </form.Field>

          {hasHeroImages ? (
            <>
              <form.Field name="home.heroLayout">
                {(field) => (
                  <HeroLayoutField
                    value={field.state.value}
                    onChange={(layout) => {
                      field.handleChange(layout);
                      // The split layout has no centre.
                      if (layout === "split" && form.getFieldValue("home.heroAlign") === "center") {
                        form.setFieldValue("home.heroAlign", "start");
                      }
                    }}
                  />
                )}
              </form.Field>

              <HeroPositionField
                align={heroAlign}
                verticalAlign={heroVerticalAlign}
                layout={heroLayout}
                onChange={(position) => {
                  form.setFieldValue("home.heroAlign", position.align);
                  form.setFieldValue("home.heroVerticalAlign", position.verticalAlign);
                }}
              />
            </>
          ) : null}
        </PanelGroup>

        <form.Field name="home.announcementEnabled">
          {(enabledField) => (
            <PanelGroup
              title={t("announcement.title")}
              action={
                <Switch
                  aria-label={t("announcement.title")}
                  checked={enabledField.state.value}
                  onCheckedChange={enabledField.handleChange}
                />
              }
            >
              {enabledField.state.value ? (
                <>
                  <form.AppField name="home.announcementText">
                    {(field) => (
                      <field.Input
                        label={t("announcement.text")}
                        placeholder={t("announcement.textPlaceholder")}
                        maxLength={MAX_ANNOUNCEMENT_LENGTH}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="home.announcementHref">
                    {(field) => (
                      <field.Input
                        label={`${t("announcement.href")} (${tCommon("optional")})`}
                        placeholder="https://"
                        type="url"
                        inputMode="url"
                      />
                    )}
                  </form.AppField>
                </>
              ) : null}
            </PanelGroup>
          )}
        </form.Field>

        <PanelGroup title={tAppearance("catalog.title")}>
          <form.Field name="home.catalogBrowseMode">
            {(field) => (
              <PanelSegmentedControl
                aria-label={tAppearance("catalogBrowseMode.title")}
                value={field.state.value}
                onChange={field.handleChange}
                options={[
                  { value: "products", label: tAppearance("catalogBrowseMode.products") },
                  { value: "categories", label: tAppearance("catalogBrowseMode.categories") },
                ]}
              />
            )}
          </form.Field>

          <form.Field name="home.maxDiscountEnabled">
            {(enabledField) => (
              <>
                <PanelSwitchRow
                  id={enabledField.name}
                  label={tAppearance("maxDiscount.title")}
                  helper={tAppearance("maxDiscount.hint")}
                  checked={enabledField.state.value}
                  onCheckedChange={enabledField.handleChange}
                />
                {enabledField.state.value ? (
                  <form.Field name="home.maxDiscountPercent">
                    {(percentField) => (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span id="max-discount-label" className="text-muted-foreground">
                            {tAppearance("maxDiscount.upTo")}
                          </span>
                          <span className="font-medium tabular-nums">
                            {percentField.state.value}%
                          </span>
                        </div>
                        <Slider
                          aria-labelledby="max-discount-label"
                          value={[percentField.state.value]}
                          onValueChange={(value) =>
                            percentField.handleChange(Array.isArray(value) ? value[0] : value)
                          }
                          min={5}
                          max={100}
                          step={5}
                        />
                      </div>
                    )}
                  </form.Field>
                ) : null}
              </>
            )}
          </form.Field>
        </PanelGroup>

        <PanelGroup title={t("sections.title")}>
          <div className="flex flex-col gap-2">
            <form.Field name="home.showReassurance">
              {(field) => (
                <PanelSwitchRow
                  id={field.name}
                  label={t("sections.reassurance")}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Field name="home.showReviews">
              {(field) => (
                <PanelSwitchRow
                  id={field.name}
                  label={t("sections.reviews")}
                  helper={t("sections.reviewsDescription")}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Field name="home.showMap">
              {(field) => (
                <PanelSwitchRow
                  id={field.name}
                  label={t("sections.map")}
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
              )}
            </form.Field>
          </div>
        </PanelGroup>
      </>
    );
  },
});
