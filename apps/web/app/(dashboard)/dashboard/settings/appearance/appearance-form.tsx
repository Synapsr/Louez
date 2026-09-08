"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { useAppForm } from "@/hooks/form/form";
import { orpc } from "@/lib/orpc/react";

import { AppearanceBrandingSection } from "./appearance-branding-section";
import { AppearanceCatalogSection } from "./appearance-catalog-section";
import { AppearanceHeroSection } from "./appearance-hero-section";
import { AppearancePreview } from "./appearance-preview";
import { usePendingImageUploads } from "./use-pending-image-uploads";
import {
  type AppearanceFormValues,
  type AppearanceStore,
  appearanceFormOptions,
  buildAppearanceDefaults,
  buildAppearancePayload,
  listReplacedImages,
} from "./util.appearance-form";

interface AppearanceFormProps {
  store: AppearanceStore;
}

/**
 * Identity, home hero and catalog settings on the left, the sketch of the
 * resulting home page on the right. Images upload as soon as they are
 * picked and only become the store's on save; until then they are pending
 * and get deleted on reset, on replace, or when the page is left.
 */
export const AppearanceForm = ({ store }: AppearanceFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.appearanceSettings");
  const tErrors = useTranslations("errors");
  const uploads = usePendingImageUploads();
  const [savedValues, setSavedValues] = useState<AppearanceFormValues>(() =>
    buildAppearanceDefaults(store),
  );

  const updateAppearance = useMutation({
    ...orpc.dashboard.settings.updateAppearance.mutationOptions(),
    mutationFn: async (value: AppearanceFormValues) => {
      const payload = buildAppearancePayload({ value, baseline: savedValues });
      if (!payload) {
        throw new Error("errors.invalidData");
      }

      const result = await orpc.dashboard.settings.updateAppearance.call(payload);
      uploads.settle(listReplacedImages({ value, baseline: savedValues }));

      return result;
    },
  });

  const form = useAppForm({
    ...appearanceFormOptions,
    defaultValues: savedValues,
    onSubmit: async ({ value }) => {
      try {
        await updateAppearance.mutateAsync(value);
        toastManager.add({ title: t("updated"), type: "success" });
        setSavedValues(value);
        form.reset(value);
        router.refresh();
      } catch (error) {
        toastManager.add({
          title:
            error instanceof Error && error.message === "errors.invalidData"
              ? tErrors("invalidData")
              : tErrors("generic"),
          type: "error",
        });
      }
    },
  });

  const isDirty = useStore(form.store, (state) => state.isDirty);

  const handleReset = () => {
    const { logoUrl, darkLogoUrl, heroImages } = form.state.values;
    if (logoUrl !== savedValues.logoUrl) uploads.discard(logoUrl);
    if (darkLogoUrl !== savedValues.darkLogoUrl) uploads.discard(darkLogoUrl);
    for (const image of heroImages) {
      if (!savedValues.heroImages.includes(image)) uploads.discard(image);
    }
    form.reset();
  };

  return (
    <form.AppForm>
      <form.Form>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-6">
            <AppearanceBrandingSection form={form} uploads={uploads} savedValues={savedValues} />
            <AppearanceHeroSection form={form} uploads={uploads} savedValues={savedValues} />
            <AppearanceCatalogSection form={form} />
          </div>
          <AppearancePreview form={form} storeName={store.name} />
        </div>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={updateAppearance.isPending || uploads.isUploading}
          onReset={handleReset}
        />
      </form.Form>
    </form.AppForm>
  );
};
