"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckoutFormView } from "@/app/(storefront)/[slug]/checkout/checkout-form-view";
import { CheckoutConfirmStep } from "@/app/(storefront)/[slug]/checkout/components/checkout-confirm-step";
import {
  checkoutFormOptions,
  createCheckoutValidator,
} from "@/app/(storefront)/[slug]/checkout/validator.checkout";
import { getCheckoutStepIds } from "@/app/(storefront)/[slug]/checkout/util.checkout-steps";
import { getCheckoutSubmitLabel } from "@/app/(storefront)/[slug]/checkout/util.checkout-totals";
import type { FeatureSceneProps } from "@/components/landing-demos/feature-demo.types";
import { CheckoutSceneFrame } from "@/components/landing-demos/features/checkout-scene-frame";
import { useDemoCue } from "@/components/landing-demos/use-demo-cue";
import { useDemoLocale } from "@/components/landing-demos/use-demo-locale";
import { ReservationPageView } from "@/components/storefront/account/reservation-page-view";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { useAppForm } from "@/hooks/form/form";
import {
  CHECKOUT_DEMO_ADVISOR,
  CHECKOUT_DEMO_PROMO,
  CHECKOUT_DEMO_QUOTE,
  CHECKOUT_DEMO_STORE,
  getDemoCheckout,
  getDemoCheckoutSummary,
} from "@/lib/landing-demos/checkout";

export const CheckoutPaymentScene = ({ period }: FeatureSceneProps) => {
  const locale = useDemoLocale();
  const t = useTranslations("storefront.checkout");
  const tDeposit = useTranslations("storefront.account.depositCard");
  const data = useMemo(() => getDemoCheckout(period, locale), [period, locale]);
  const [submitted, setSubmitted] = useState(false);
  const [paid, setPaid] = useState(false);
  const form = useAppForm({
    ...checkoutFormOptions,
    defaultValues: data.values,
    validators: {
      onSubmit: createCheckoutValidator((key, params) => t(key, params), {
        requireAddress: true,
        country: "FR",
      }),
    },
    onSubmit: () => {
      setSubmitted(true);
    },
  });
  useDemoCue("checkout-payment-paid", () => {
    if (submitted) setPaid(true);
  });
  const summary = getDemoCheckoutSummary(data.cart);

  return (
    <CheckoutSceneFrame period={period} count={paid ? 0 : data.cart.summary.count}>
      {paid ? (
        <ReservationPageView
          {...data.paidReservation}
          readOnly
          items={{ ...data.paidReservation.items, depositLabel: tDeposit("states.held.badge") }}
        />
      ) : (
        <StorefrontSection spacing="tight">
          <CheckoutFormView
            returnHref="#"
            steps={getCheckoutStepIds({ isDeliveryEnabled: false })}
            currentStep="confirm"
            summaryProps={summary}
          >
            <form.AppForm>
              <form.Form
                formName="checkout-demo"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <CheckoutConfirmStep
                  form={form}
                  reservationMode="payment"
                  logisticsLabel={CHECKOUT_DEMO_STORE.name}
                  tulipQuote={CHECKOUT_DEMO_QUOTE}
                  advisorGate={CHECKOUT_DEMO_ADVISOR}
                  promo={CHECKOUT_DEMO_PROMO}
                  hasActivePromoCodes={false}
                  totalDeposit={data.cart.summary.deposit}
                  submitLabel={getCheckoutSubmitLabel(summary.totals, "payment")}
                  blockedReason={null}
                  advanceNoticeIssue={null}
                  isSubmitting={submitted}
                  onBack={() => {}}
                  onEditContact={() => {}}
                  onEditDates={() => {}}
                  stepDirection="forward"
                  termsPrefetch={false}
                />
              </form.Form>
            </form.AppForm>
          </CheckoutFormView>
        </StorefrontSection>
      )}
    </CheckoutSceneFrame>
  );
};
