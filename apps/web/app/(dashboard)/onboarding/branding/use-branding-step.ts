"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import {
  type BrandingInput,
  createBrandingSchema,
  isValidImageUrlClient,
} from "@louez/validations";

import { orpc } from "@/lib/orpc/react";
import {
  onboardingAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import { useAppForm } from "@/hooks/form/form";
import { useImageUpload } from "@/hooks/use-image-upload";

import { useOnboardingErrorToast } from "../_lib/onboarding-error-toast";
import { useOnboardingPreview } from "../_lib/preview-context";
import { useOnboardingDraft } from "../_lib/use-onboarding-draft";

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const useBrandingStep = () => {
  const router = useRouter();
  const tValidation = useTranslations("validation");
  const showError = useOnboardingErrorToast();
  const posthog = usePostHog();
  const { updatePreview } = useOnboardingPreview();

  const brandingSchema = createBrandingSchema(tValidation);

  const { uploadImage, deleteImage, isUploading } = useImageUpload("logo");
  const draftQuery = useOnboardingDraft();
  const updateBrandingMutation = useMutation(
    orpc.dashboard.onboarding.updateBranding.mutationOptions(),
  );

  const selectedLogoFile = useRef<File | null>(null);
  const localPreviewUrl = useRef<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  const releaseLocalPreview = useCallback(() => {
    if (!localPreviewUrl.current) return;
    URL.revokeObjectURL(localPreviewUrl.current);
    localPreviewUrl.current = null;
    setLogoPreviewUrl(null);
  }, []);

  useEffect(() => releaseLocalPreview, [releaseLocalPreview]);

  const form = useAppForm({
    defaultValues: {
      logoUrl: "",
      primaryColor: "#0066FF",
      theme: "light" as "light" | "dark",
    } as BrandingInput,
    validators: { onSubmit: brandingSchema },
    onSubmit: async ({ value }) => {
      let uploadedKey: string | null = null;

      try {
        const previousLogoUrl = draftQuery.data?.branding.logoUrl || "";
        let logoUrl = value.logoUrl && isValidImageUrlClient(value.logoUrl) ? value.logoUrl : "";

        if (selectedLogoFile.current) {
          const uploaded = await uploadImage(selectedLogoFile.current);
          uploadedKey = uploaded.key;
          logoUrl = uploaded.url;
        }

        await updateBrandingMutation.mutateAsync({
          ...value,
          logoUrl,
        });

        posthog.capture(productAnalyticsEvents.onboardingBrandingSaved, {
          ...onboardingAnalyticsBaseProperties,
          has_logo: Boolean(logoUrl),
          theme: value.theme,
          primary_color: value.primaryColor,
          is_default_primary_color: value.primaryColor === "#0066FF",
        });

        selectedLogoFile.current = null;
        releaseLocalPreview();
        form.setFieldValue("logoUrl", logoUrl);

        if (previousLogoUrl && previousLogoUrl !== logoUrl) {
          void deleteImage(previousLogoUrl).catch(() => undefined);
        }

        router.push("/onboarding/stripe");
      } catch (error) {
        if (uploadedKey) {
          void deleteImage(uploadedKey).catch(() => undefined);
        }
        showError(error);
      }
    },
  });

  const hasHydratedDraft = useRef(false);

  useEffect(() => {
    if (hasHydratedDraft.current) return;

    const draft = draftQuery.data?.branding;
    if (!draft) return;

    const logoUrl = draft.logoUrl && isValidImageUrlClient(draft.logoUrl) ? draft.logoUrl : "";

    form.setFieldValue("logoUrl", logoUrl);
    form.setFieldValue("primaryColor", draft.primaryColor || "#0066FF");
    form.setFieldValue("theme", draft.theme === "dark" ? "dark" : "light");

    hasHydratedDraft.current = true;
  }, [draftQuery.data, form]);

  // Keep the live preview in sync with the store draft and the form values
  useEffect(() => {
    const store = draftQuery.data?.store;
    if (!store) return;

    updatePreview({ storeName: store.name || "", slug: store.slug || "" });
  }, [draftQuery.data, updatePreview]);

  const brandingValues = useStore(form.store, (s) => s.values);

  useEffect(() => {
    updatePreview({
      logoUrl: logoPreviewUrl || brandingValues.logoUrl || null,
      theme: brandingValues.theme === "dark" ? "dark" : "light",
      ...(HEX_COLOR_PATTERN.test(brandingValues.primaryColor)
        ? { primaryColor: brandingValues.primaryColor }
        : {}),
    });
  }, [
    brandingValues.logoUrl,
    brandingValues.primaryColor,
    brandingValues.theme,
    logoPreviewUrl,
    updatePreview,
  ]);

  const handleLogoSelected = useCallback(
    (file: File) => {
      releaseLocalPreview();
      const previewUrl = URL.createObjectURL(file);
      localPreviewUrl.current = previewUrl;
      setLogoPreviewUrl(previewUrl);
      selectedLogoFile.current = file;
    },
    [releaseLocalPreview],
  );

  const handleLogoRemove = useCallback(() => {
    selectedLogoFile.current = null;
    releaseLocalPreview();
    form.setFieldValue("logoUrl", "");
  }, [form, releaseLocalPreview]);

  return {
    form,
    logoPreviewUrl,
    handleLogoSelected,
    handleLogoRemove,
    isUploading,
    isBusy: updateBrandingMutation.isPending || isUploading,
  };
};
