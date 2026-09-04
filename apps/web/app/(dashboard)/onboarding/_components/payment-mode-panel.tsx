"use client";

import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { useOnboardingPreview } from "../_lib/preview-context";
import { PAYMENT_BENEFITS, PAYMENT_KYC_STEPS } from "../_lib/stripe-panel-content";
import { useStripeConnectStart } from "../_lib/use-stripe-connect-start";
import { PanelSectionTitle } from "./panel-section-title";
import { ReeentPaymentPanel } from "./reeent-payment-panel";

function PaymentPanel() {
  const t = useTranslations("onboarding.stripe.panel.payment");
  const { startStripeConnect, isConnecting, hasPendingAccount } = useStripeConnectStart({
    fromReeent: false,
  });

  return (
    <div key="payment" className="animate-in fade-in slide-in-from-bottom-2 space-y-8 duration-500">
      <section className="space-y-4">
        <PanelSectionTitle>{t("benefitsTitle")}</PanelSectionTitle>
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
        <PanelSectionTitle>{t("kycTitle")}</PanelSectionTitle>
        <ol className="space-y-3">
          {PAYMENT_KYC_STEPS.map((key, index) => (
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
        <Button onClick={startStripeConnect} isPending={isConnecting}>
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
        <PanelSectionTitle>{t("howTitle")}</PanelSectionTitle>
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
        <PanelSectionTitle>{t("prosTitle")}</PanelSectionTitle>
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
        <PanelSectionTitle>{t("consTitle")}</PanelSectionTitle>
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
 *
 * Loueurs coming from reeent have no mode to choose — reeent only publishes
 * stores that can charge online — so they get the explanation-only variant.
 */
export function PaymentModePanel({ fromReeent }: { fromReeent: boolean }) {
  const { preview } = useOnboardingPreview();

  if (fromReeent) return <ReeentPaymentPanel />;

  return preview.reservationMode === "payment" ? <PaymentPanel /> : <RequestPanel />;
}
