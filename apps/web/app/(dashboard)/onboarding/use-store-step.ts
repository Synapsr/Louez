"use client";

import { useEffect, useRef } from "react";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  type StoreInfoInput,
  createStoreInfoSchema,
  isValidImageUrlClient,
} from "@louez/validations";

import { apiErrorKey } from "@/lib/orpc/errors";
import { orpc } from "@/lib/orpc/react";
import { getDefaultCurrencyForCountry } from "@/lib/utils/currency";
import { createLoginUrl } from "@/lib/utils/util.url";
import { detectCountryFromBrowser } from "@/lib/utils/util.browser-country-detection";

import { useAppForm } from "@/hooks/form/form";

import { useOnboardingErrorToast } from "./_lib/onboarding-error-toast";
import { useOnboardingPreview } from "./_lib/preview-context";
import { useOnboardingDraft } from "./_lib/use-onboarding-draft";
import { useStepNavigation } from "./_lib/use-step-navigation";

interface UseStoreStepParams {
  editingStoreId: string | null;
  initialCountry: string;
  shouldDetectBrowserCountry: boolean;
}

export const useStoreStep = ({
  editingStoreId,
  initialCountry,
  shouldDetectBrowserCountry,
}: UseStoreStepParams) => {
  const { goToNextStep, isNavigating } = useStepNavigation("/onboarding/branding");
  const tErrors = useTranslations("errors");
  const tValidation = useTranslations("validation");
  const showError = useOnboardingErrorToast();

  const storeInfoSchema = createStoreInfoSchema(tValidation);

  // The store being onboarded is saved; without one, the step creates it.
  // Each answer makes its store the active one.
  const saveInfo = useMutation(orpc.dashboard.stores.updateOnboardingInfo.mutationOptions());
  const createStore = useMutation(orpc.dashboard.stores.create.mutationOptions());
  const saveStore = async (value: StoreInfoInput) => {
    const saved = await saveInfo.mutateAsync({ ...value, storeId: editingStoreId });
    if (saved.id === null) await createStore.mutateAsync(value);
  };

  const setSlugTakenError = () => {
    form.setFieldMeta("slug", (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev.errorMap,
        onSubmit: tErrors("slugTaken"),
      },
    }));
  };

  const clearSlugSubmitError = () => {
    form.setFieldMeta("slug", (prev) => ({
      ...prev,
      errorMap: {
        ...prev.errorMap,
        onSubmit: undefined,
      },
    }));
  };

  const form = useAppForm({
    defaultValues: {
      name: "",
      slug: "",
      country: initialCountry,
      currency: String(getDefaultCurrencyForCountry(initialCountry)),
      address: "",
      latitude: null as number | null,
      longitude: null as number | null,
      email: "",
      phone: "",
    },
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: {
      onSubmit: storeInfoSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        // Validated on submit: the parse only narrows the currency to a supported code.
        await saveStore(storeInfoSchema.parse(value));
        goToNextStep();
      } catch (error) {
        const key = apiErrorKey(error);
        if (key === "unauthenticated") {
          window.location.replace(createLoginUrl("/onboarding"));
          return;
        }

        // Map the slug conflict to a field-level error, everything else to a toast
        if (key === "slugTaken") {
          setSlugTakenError();
          return;
        }
        showError(error);
      }
    },
  });

  const draftQuery = useOnboardingDraft({ enabled: editingStoreId !== null });

  const hasHydratedDraft = useRef(false);
  const hasAppliedBrowserDefaults = useRef(!shouldDetectBrowserCountry);
  const formValues = useStore(form.store, (s) => s.values);
  const { updatePreview } = useOnboardingPreview();

  useEffect(() => {
    updatePreview({ storeName: formValues.name, slug: formValues.slug });
  }, [formValues.name, formValues.slug, updatePreview]);

  const hasSeededBrandingPreview = useRef(false);

  useEffect(() => {
    if (hasSeededBrandingPreview.current) return;

    const branding = draftQuery.data?.branding;
    if (!branding) return;

    updatePreview({
      logoUrl:
        branding.logoUrl && isValidImageUrlClient(branding.logoUrl) ? branding.logoUrl : null,
      primaryColor: branding.primaryColor || "#0066FF",
      theme: branding.theme === "dark" ? "dark" : "light",
    });

    hasSeededBrandingPreview.current = true;
  }, [draftQuery.data, updatePreview]);

  useEffect(() => {
    if (hasHydratedDraft.current) return;

    const draft = draftQuery.data?.store;
    if (!draft) return;

    const hasLocalInput = Boolean(
      formValues.name ||
      formValues.slug ||
      formValues.address ||
      formValues.email ||
      formValues.phone,
    );
    if (hasLocalInput) {
      hasHydratedDraft.current = true;
      return;
    }

    form.setFieldValue("name", draft.name || "");
    form.setFieldValue("slug", draft.slug || "");
    form.setFieldValue("address", draft.address || "");
    form.setFieldValue("latitude", draft.latitude ?? null);
    form.setFieldValue("longitude", draft.longitude ?? null);
    form.setFieldValue("email", draft.email || "");
    form.setFieldValue("phone", draft.phone || "");
    if (draft.country) {
      form.setFieldValue("country", draft.country);
    }
    if (draft.currency) {
      form.setFieldValue("currency", draft.currency);
    }

    hasHydratedDraft.current = true;
    hasAppliedBrowserDefaults.current = true;
  }, [
    draftQuery.data,
    form,
    formValues.address,
    formValues.email,
    formValues.name,
    formValues.phone,
    formValues.slug,
  ]);

  useEffect(() => {
    if (hasAppliedBrowserDefaults.current) return;

    const detection = detectCountryFromBrowser();
    const detectedCurrency = getDefaultCurrencyForCountry(detection.country);

    form.setFieldValue("country", detection.country);
    form.setFieldValue("currency", detectedCurrency);

    hasAppliedBrowserDefaults.current = true;
  }, [form]);

  const handleCountrySelection = (newCountry: string) => {
    form.setFieldValue("currency", getDefaultCurrencyForCountry(newCountry));
  };

  return {
    form,
    clearSlugSubmitError,
    handleCountrySelection,
    country: formValues.country,
    latitude: formValues.latitude,
    longitude: formValues.longitude,
    isNavigating,
  };
};
