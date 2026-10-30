"use client";

import { useEffect } from "react";

import { isValidImageUrlClient } from "@louez/validations";

import { useOnboardingPreview } from "./preview-context";
import { useOnboardingDraft } from "./use-onboarding-draft";

/**
 * Keeps the live preview in sync with the saved draft, for the steps after the store
 * and branding ones: after a reload, or a return from Stripe, the
 * preview starts empty.
 */
export const useDraftPreview = () => {
  const { updatePreview } = useOnboardingPreview();
  const draftQuery = useOnboardingDraft();

  useEffect(() => {
    const data = draftQuery.data;
    if (!data?.store) return;

    const branding = data.branding;
    updatePreview({
      storeName: data.store.name || "",
      slug: data.store.slug || "",
      ...(branding
        ? {
            logoUrl:
              branding.logoUrl && isValidImageUrlClient(branding.logoUrl) ? branding.logoUrl : null,
            primaryColor: branding.primaryColor || "#0066FF",
            theme: branding.theme === "dark" ? "dark" : "light",
          }
        : {}),
    });
  }, [draftQuery.data, updatePreview]);
};
