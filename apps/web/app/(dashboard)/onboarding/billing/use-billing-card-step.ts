"use client";

import { useRouter } from "next/navigation";

import { BILLING_CARD_STEP_PATH } from "@/lib/billing/billing-routes";

import { getNextOnboardingPath } from "../_lib/steps";
import { useOnboardingSteps } from "../_lib/steps-context";
import { useDraftPreview } from "../_lib/use-draft-preview";

export const useBillingCardStep = () => {
  const router = useRouter();
  const nextPath = getNextOnboardingPath(useOnboardingSteps(), BILLING_CARD_STEP_PATH);

  // The owner often lands here from the billing pages, on a fresh page load.
  useDraftPreview();

  // Nothing to save: the card lives on the billing pages, and the store keeps asking
  // for it (dashboard banner, billing settings) until it is there.
  const handleLater = () => router.push(nextPath);

  return { handleLater };
};
