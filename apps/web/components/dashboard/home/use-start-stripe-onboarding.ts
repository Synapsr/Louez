"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { startStripeOnboarding } from "@/app/(dashboard)/dashboard/settings/payments/actions";

/**
 * Starts, or resumes, the Stripe form from the home: the server action hands
 * back Stripe's URL and the browser goes there. Errors land in a toast.
 */
export const useStartStripeOnboarding = () => {
  const tErrors = useTranslations("errors");
  const [isPending, setIsPending] = useState(false);

  const start = async () => {
    setIsPending(true);
    try {
      const result = await startStripeOnboarding();
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace("errors.", "")), type: "error" });
      } else if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    } finally {
      setIsPending(false);
    }
  };

  return { start, isPending };
};
