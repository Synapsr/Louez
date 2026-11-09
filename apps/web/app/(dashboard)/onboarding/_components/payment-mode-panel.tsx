"use client";

import { useId } from "react";

import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";

import { useOnboardingPreview } from "../_lib/preview-context";
import { PAYMENT_BENEFIT_CARDS, PAYMENT_KYC_STEPS } from "../_lib/stripe-panel-content";
import { PanelSectionTitle } from "./panel-section-title";
import { PanelSteps } from "./panel-steps";
import { ReeentPaymentPanel } from "./reeent-payment-panel";

function PaymentPanel() {
  const t = useTranslations("onboarding.stripe.panel.payment");
  const iconId = useId();

  return (
    <div key="payment" className="animate-in fade-in slide-in-from-bottom-2 space-y-7 duration-500">
      <h2 className="text-xl font-extrabold tracking-tight text-balance">{t("headline")}</h2>

      <section className="space-y-3">
        <PanelSectionTitle>{t("benefitsTitle")}</PanelSectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          {PAYMENT_BENEFIT_CARDS.map(({ key, icon: Icon }) => (
            <div key={key} className="bg-card shadow-card flex flex-col gap-2.5 rounded-xl p-3.5">
              <Icon uniqueId={`${iconId}-${key}`} size={32} />
              <p className="text-sm leading-snug">{t(key)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <PanelSectionTitle>{t("kycTitle")}</PanelSectionTitle>
        <PanelSteps steps={PAYMENT_KYC_STEPS.map((key) => ({ key, title: t(key) }))} />
      </section>

      <p className="text-muted-foreground text-sm">
        <span className="text-foreground font-semibold">{t("laterTitle")}</span> {t("laterBody")}
      </p>
    </div>
  );
}

function RequestPanel() {
  const t = useTranslations("onboarding.stripe.panel.request");

  // Five events folded into three steps: each one pairs what happens with
  // what follows from it.
  const steps = [
    { key: "send", title: t("step1"), detail: t("step2") },
    { key: "decide", title: t("step3"), detail: t("step4") },
    { key: "collect", title: t("step5"), detail: t("pros3") },
  ];

  return (
    <div key="request" className="animate-in fade-in slide-in-from-bottom-2 space-y-7 duration-500">
      <h2 className="text-xl font-extrabold tracking-tight text-balance">{t("headline")}</h2>

      <section className="space-y-3">
        <PanelSectionTitle>{t("howTitle")}</PanelSectionTitle>
        <PanelSteps steps={steps} />
      </section>

      <section className="space-y-3">
        <PanelSectionTitle>{t("goodToKnow")}</PanelSectionTitle>
        <ul className="space-y-2 text-sm">
          {(["pros1", "pros2"] as const).map((key) => (
            <li key={key} className="flex items-center gap-2.5">
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500" />
              {t(key)}
            </li>
          ))}
          {(["cons1", "cons2", "cons3"] as const).map((key) => (
            <li key={key} className="text-muted-foreground flex items-center gap-2.5">
              <Minus className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
              {t(key)}
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
 * selection live. It holds no action: the step's buttons sit under the choice.
 *
 * Loueurs coming from reeent have no mode to choose — reeent only publishes
 * stores that can charge online — so they get the explanation-only variant.
 */
export function PaymentModePanel({ fromReeent }: { fromReeent: boolean }) {
  const { preview } = useOnboardingPreview();

  if (fromReeent) return <ReeentPaymentPanel />;

  return preview.reservationMode === "payment" ? <PaymentPanel /> : <RequestPanel />;
}
