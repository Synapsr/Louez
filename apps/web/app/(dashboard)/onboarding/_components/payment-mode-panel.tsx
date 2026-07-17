"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { Banknote, CalendarCheck, Check, Loader2, Minus, ShieldCheck, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { Button, toastManager } from "@louez/ui";

import { orpc } from "@/lib/orpc/react";
import {
  onboardingAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import { startStripeOnboarding } from "../../dashboard/settings/payments/actions";
import { useOnboardingErrorToast } from "../_lib/onboarding-error-toast";
import { useOnboardingPreview } from "../_lib/preview-context";
import { useOnboardingDraft } from "../_lib/use-onboarding-draft";

const PAYMENT_BENEFITS = [
  { key: "benefit1", icon: Zap },
  { key: "benefit2", icon: CalendarCheck },
  { key: "benefit3", icon: ShieldCheck },
  { key: "benefit4", icon: Banknote },
] as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
      {children}
    </h2>
  );
}

function PaymentPanel({ stripeReturnPath }: { stripeReturnPath?: string }) {
  const t = useTranslations("onboarding.stripe.panel.payment");
  const tErrors = useTranslations("errors");
  const showError = useOnboardingErrorToast();
  const posthog = usePostHog();
  const [isConnecting, setIsConnecting] = useState(false);

  // A KYC left midway keeps its Connect account: the CTA reads "resume" then.
  const draftQuery = useOnboardingDraft();
  const hasPendingAccount = draftQuery.data?.stripe?.hasPendingAccount ?? false;

  const completeOnboardingMutation = useMutation(
    orpc.dashboard.onboarding.complete.mutationOptions(),
  );

  // Completes onboarding (payment mode) first so the Stripe callback lands on
  // a finished dashboard, then hands off to the Stripe-hosted KYC flow.
  const handleConfigureNow = async () => {
    setIsConnecting(true);
    // Captured before the Stripe redirect so the event has time to flush
    // while onboarding completion and account-link creation run.
    posthog.capture(productAnalyticsEvents.onboardingStripeConnectStarted, {
      ...onboardingAnalyticsBaseProperties,
      is_resume: hasPendingAccount,
    });
    try {
      await completeOnboardingMutation.mutateAsync({ reservationMode: "payment" });
      sessionStorage.setItem("louez-show-welcome", "1");
    } catch (error) {
      showError(error);
      setIsConnecting(false);
      return;
    }
    try {
      const result = await startStripeOnboarding(
        stripeReturnPath ? { next: stripeReturnPath } : undefined,
      );
      if (result.url) {
        window.location.href = result.url;
        return;
      }
      toastManager.add({
        title: tErrors(result.error ? result.error.replace("errors.", "") : "generic"),
        type: "error",
      });
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    }
    setIsConnecting(false);
  };

  return (
    <div key="payment" className="animate-in fade-in slide-in-from-bottom-2 space-y-8 duration-500">
      <section className="space-y-4">
        <SectionTitle>{t("benefitsTitle")}</SectionTitle>
        <ul className="space-y-3">
          {PAYMENT_BENEFITS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex items-center gap-3">
              <Icon className="text-muted-foreground size-4 shrink-0" />
              <p className="text-sm">{t(key)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionTitle>{t("kycTitle")}</SectionTitle>
        <ol className="space-y-3">
          {(["kycStep1", "kycStep2", "kycStep3"] as const).map((key, index) => (
            <li key={key} className="flex gap-3">
              <span className="text-muted-foreground w-4 shrink-0 text-sm tabular-nums">
                {index + 1}.
              </span>
              <p className="text-sm">{t(key)}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="space-y-3">
        <Button onClick={handleConfigureNow} disabled={isConnecting}>
          {isConnecting && <Loader2 className="size-4 animate-spin" />}
          {t(hasPendingAccount ? "resumeNow" : "configureNow")}
        </Button>
        <p className="text-muted-foreground text-sm">{t("configureLater")}</p>
      </div>
    </div>
  );
}

function RequestPanel() {
  const t = useTranslations("onboarding.stripe.panel.request");

  return (
    <div key="request" className="animate-in fade-in slide-in-from-bottom-2 space-y-8 duration-500">
      <section className="space-y-4">
        <SectionTitle>{t("howTitle")}</SectionTitle>
        <ol className="space-y-3">
          {(["step1", "step2", "step3", "step4", "step5"] as const).map((key, index) => (
            <li key={key} className="flex gap-3">
              <span className="text-muted-foreground w-4 shrink-0 text-sm tabular-nums">
                {index + 1}.
              </span>
              <p className="text-sm">{t(key)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <SectionTitle>{t("prosTitle")}</SectionTitle>
        <ul className="space-y-3">
          {(["pros1", "pros2", "pros3"] as const).map((key) => (
            <li key={key} className="flex items-center gap-3">
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
              <p className="text-sm">{t(key)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <SectionTitle>{t("consTitle")}</SectionTitle>
        <ul className="space-y-3">
          {(["cons1", "cons2", "cons3"] as const).map((key) => (
            <li key={key} className="flex items-center gap-3">
              <Minus className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <p className="text-sm">{t(key)}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-muted-foreground text-sm">{t("switchNote")}</p>
    </div>
  );
}

/**
 * Right-column companion of the reservation-mode step: instead of the
 * storefront preview, it explains the selected mode (Stripe benefits + KYC
 * steps vs. how manual mode works and its trade-offs) and follows the radio
 * selection live.
 */
export function PaymentModePanel({ stripeReturnPath }: { stripeReturnPath?: string }) {
  const { preview } = useOnboardingPreview();

  return preview.reservationMode === "payment" ? (
    <PaymentPanel stripeReturnPath={stripeReturnPath} />
  ) : (
    <RequestPanel />
  );
}
