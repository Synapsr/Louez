"use client";

import { useEffect } from "react";

import { useRouter } from "next/navigation";

import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";
import { stripeSetupSchema } from "@louez/validations";

import { orpc } from "@/lib/orpc/react";

import { useAppForm } from "@/hooks/form/form";

import { useOnboardingErrorToast } from "../_lib/onboarding-error-toast";
import { useOnboardingPreview } from "../_lib/preview-context";
import { getNextOnboardingPath } from "../_lib/steps";
import { useOnboardingSteps } from "../_lib/steps-context";
import { useDraftPreview } from "../_lib/use-draft-preview";

export const useStripeStep = () => {
  const router = useRouter();
  const t = useTranslations("onboarding.stripe");
  const showError = useOnboardingErrorToast();
  const { updatePreview } = useOnboardingPreview();
  // The billing card step or the source step when this flow has them.
  const nextPath = getNextOnboardingPath(useOnboardingSteps(), "/onboarding/stripe");

  const completeOnboardingMutation = useMutation(
    orpc.dashboard.onboarding.complete.mutationOptions(),
  );

  useDraftPreview();

  const form = useAppForm({
    defaultValues: {
      reservationMode: "payment" as "request" | "payment",
    },
    validators: {
      onSubmit: stripeSetupSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await completeOnboardingMutation.mutateAsync(value);
        toastManager.add({ title: t("configComplete"), type: "success" });
        // Signal the welcome animation via sessionStorage (more reliable than URL params)
        sessionStorage.setItem("louez-show-welcome", "1");
        router.push(nextPath);
      } catch (error) {
        showError(error);
      }
    },
  });

  const reservationMode = useStore(form.store, (s) => s.values.reservationMode);

  useEffect(() => {
    updatePreview({ reservationMode });
  }, [reservationMode, updatePreview]);

  return {
    form,
    reservationMode,
    isPending: completeOnboardingMutation.isPending,
  };
};
