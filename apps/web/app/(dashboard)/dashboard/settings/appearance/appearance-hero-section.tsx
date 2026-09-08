"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Separator } from "@louez/ui";
import { LayoutIcon } from "@louez/ui/icons";

import { withForm } from "@/hooks/form/form";

import { HeroImagesField } from "./hero-images-field";
import { HeroLayoutField } from "./hero-layout-field";
import { HeroPositionField } from "./hero-position-field";
import type { PendingImageUploads } from "./use-pending-image-uploads";
import {
  type AppearanceFormValues,
  appearanceFormOptions,
  appearanceSectionProps,
} from "./util.appearance-form";

interface AppearanceHeroSectionProps {
  uploads: PendingImageUploads;
  /** The last saved values, so only unsaved uploads get deleted. */
  savedValues: AppearanceFormValues;
}

/** The home hero: its photos, its layout, where the text sits. */
export const AppearanceHeroSection = withForm({
  ...appearanceFormOptions,
  props: appearanceSectionProps<AppearanceHeroSectionProps>(),
  render: ({ form, uploads, savedValues }) => {
    const t = useTranslations("dashboard.settings.appearanceSettings");
    const heroLayout = useStore(form.store, (state) => state.values.heroLayout);
    const heroAlign = useStore(form.store, (state) => state.values.heroAlign);
    const heroVerticalAlign = useStore(form.store, (state) => state.values.heroVerticalAlign);

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutIcon />
            {t("home.title")}
          </CardTitle>
          <CardDescription>{t("home.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form.Field name="heroImages">
            {(field) => (
              <HeroImagesField
                value={field.state.value}
                savedValue={savedValues.heroImages}
                uploads={uploads}
                onChange={field.handleChange}
              />
            )}
          </form.Field>

          <Separator />

          <form.Field name="heroLayout">
            {(field) => (
              <HeroLayoutField
                value={field.state.value}
                onChange={(layout) => {
                  field.handleChange(layout);
                  // The split layout has no centre.
                  if (layout === "split" && form.getFieldValue("heroAlign") === "center") {
                    form.setFieldValue("heroAlign", "start");
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
              form.setFieldValue("heroAlign", position.align);
              form.setFieldValue("heroVerticalAlign", position.verticalAlign);
            }}
          />
        </CardContent>
      </Card>
    );
  },
});
