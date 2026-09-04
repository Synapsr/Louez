"use client";

import { useTranslations } from "next-intl";

import { PAYMENT_BENEFITS, PAYMENT_KYC_STEPS } from "../_lib/stripe-panel-content";
import { PanelSectionTitle } from "./panel-section-title";

/**
 * Right-column companion of the Stripe step for loueurs reeent sent over. It
 * only explains — the single CTA of that variant lives in the left column, so
 * the screen never asks the same thing twice — and it starts with where the
 * money goes, the question that decides whether Stripe feels safe.
 */
export const ReeentPaymentPanel = () => {
  const t = useTranslations("onboarding.stripe.reeent");
  const tPanel = useTranslations("onboarding.stripe.panel.payment");

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-8 duration-500">
      <section className="space-y-4">
        <PanelSectionTitle>{t("panelWhyTitle")}</PanelSectionTitle>
        <div className="space-y-3">
          <p className="text-sm leading-relaxed">{t("why1")}</p>
          <p className="text-sm leading-relaxed">{t("why2")}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">{t("withoutStripe")}</p>
        </div>
      </section>

      <section className="space-y-4">
        <PanelSectionTitle>{tPanel("benefitsTitle")}</PanelSectionTitle>
        <ul className="space-y-3">
          {PAYMENT_BENEFITS.map(({ key, icon: Icon }) => (
            <li key={key} className="flex items-center gap-3">
              <Icon className="text-muted-foreground size-4 shrink-0" />
              <p className="text-sm">{tPanel(key)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4">
        <PanelSectionTitle>{tPanel("kycTitle")}</PanelSectionTitle>
        <ol className="space-y-3">
          {PAYMENT_KYC_STEPS.map((key, index) => (
            <li key={key} className="flex gap-3">
              <span className="text-muted-foreground w-4 shrink-0 text-sm tabular-nums">
                {index + 1}.
              </span>
              <p className="text-sm">{tPanel(key)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};
