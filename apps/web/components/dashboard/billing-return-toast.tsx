"use client";

import { useEffect, useRef } from "react";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { BILLING_RETURN_PARAM, readBillingReturnOutcome } from "@/lib/billing/billing-return";

/**
 * The toast of the return from the billing pages (`/dashboard/billing/return`), which
 * redirects to the settings or the onboarding with `?billing=`. Shown once, then the
 * parameter leaves the URL. `BillingReturnToastSlot` mounts it, in service mode only.
 */
export const BillingReturnToast = () => {
  const t = useTranslations("dashboard.settings.billingReturn");
  const searchParams = useSearchParams();
  const outcome = readBillingReturnOutcome(searchParams.get(BILLING_RETURN_PARAM));
  // Strict mode runs the effect twice before the URL change lands.
  const shown = useRef(false);

  useEffect(() => {
    if (!outcome) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    toastManager.add(
      outcome === "refreshed"
        ? { type: "success", title: t("refreshed") }
        : { type: "info", title: t("pending") },
    );
    const url = new URL(window.location.href);
    url.searchParams.delete(BILLING_RETURN_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [outcome, t]);

  return null;
};
