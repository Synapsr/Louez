"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";

import { withForm } from "@/hooks/form/form";

import { StorefrontSketch } from "./storefront-sketch";
import { appearanceFormOptions, appearanceSectionProps } from "./util.appearance-form";

interface AppearancePreviewProps {
  storeName: string;
}

/** The sketch of the home page, redrawn from the form as it is being edited. */
export const AppearancePreview = withForm({
  ...appearanceFormOptions,
  props: appearanceSectionProps<AppearancePreviewProps>(),
  render: ({ form, storeName }) => {
    const t = useTranslations("dashboard.settings.appearanceSettings");
    const values = useStore(form.store, (state) => state.values);

    return (
      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>{t("preview")}</CardTitle>
          <CardDescription>{t("previewHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <StorefrontSketch storeName={storeName} values={values} />
        </CardContent>
      </Card>
    );
  },
});
