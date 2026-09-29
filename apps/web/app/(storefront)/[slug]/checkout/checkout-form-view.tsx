"use client";

import type { ComponentProps, ReactNode, Ref } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@louez/utils";
import { BackLink } from "@/components/storefront/ui/back-link";
import type { StepId } from "@/app/(storefront)/[slug]/checkout/checkout.types";
import { CheckoutOrderSummary } from "@/app/(storefront)/[slug]/checkout/components/checkout-order-summary";
import { CheckoutSummaryBar } from "@/app/(storefront)/[slug]/checkout/components/checkout-summary-bar";

interface CheckoutFormViewProps {
  returnHref: string;
  steps: StepId[];
  currentStep: StepId;
  summaryProps: ComponentProps<typeof CheckoutOrderSummary>;
  stepRef?: Ref<HTMLDivElement>;
  error?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Checkout layout shared by the live form and supplied-data previews. */
export const CheckoutFormView = ({
  returnHref,
  steps,
  currentStep,
  summaryProps,
  stepRef,
  error,
  children,
  footer,
}: CheckoutFormViewProps) => {
  const t = useTranslations("storefront.checkout");
  const currentStepIndex = steps.indexOf(currentStep);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackLink href={returnHref} />
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
          {t("title")}
        </h1>
      </div>

      <CheckoutSummaryBar {...summaryProps} />

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={currentStepIndex + 1}
        aria-label={t("title")}
        aria-valuetext={
          currentStep === "delivery" ? t("fulfillmentTitle") : t(`steps.${currentStep}`)
        }
        className="flex gap-1.5"
      >
        {steps.map((id, index) => (
          <div
            key={id}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-500 motion-reduce:transition-none",
              index <= currentStepIndex ? "bg-foreground" : "bg-border",
            )}
          />
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div ref={stepRef} className="min-w-0 scroll-mt-4">
          {error}

          {children}
        </div>

        <aside
          className="hidden lg:sticky lg:top-4 lg:block"
          data-demo-target="checkout-order-summary"
        >
          <CheckoutOrderSummary {...summaryProps} />
        </aside>
      </div>

      {footer}
    </div>
  );
};
