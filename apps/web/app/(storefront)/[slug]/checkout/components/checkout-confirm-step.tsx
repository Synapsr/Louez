"use client";

import { useStore } from "@tanstack/react-form";
import { ChevronLeft, CreditCard, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Label,
  StepContent,
} from "@louez/ui";

import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { withForm } from "@/hooks/form/form";
import { getFieldError } from "@/hooks/form/form-context";
import { useFormatMoney } from "@/hooks/use-format-money";

import type {
  CheckoutBlockedReason,
  CheckoutTulipInsurance,
  ReservationMode,
} from "../checkout.types";
import type { AdvanceNoticeIssueDisplay } from "../hooks/use-checkout-advance-notice";
import type { useCheckoutAdvisorGate } from "../hooks/use-checkout-advisor-gate";
import type { useCheckoutPromo } from "../hooks/use-checkout-promo";
import type { useCheckoutTulipQuote } from "../hooks/use-checkout-tulip-quote";
import type { CheckoutSubmitLabel } from "../util.checkout-totals";
import { checkoutFormOptions, checkoutStepProps } from "../validator.checkout";
import { CheckoutAdvisorGateCard } from "./checkout-advisor-gate";
import {
  CHECKOUT_SUBMIT_ID,
  CheckoutAdvisorVerificationPanel,
} from "./checkout-advisor-verification-panel";
import { CheckoutDeposit } from "./checkout-deposit";
import { CheckoutPromoCode } from "./checkout-promo-code";
import { CheckoutStepActions } from "./checkout-step-actions";
import { InsuranceOptionCard } from "./insurance-option-card";

interface CheckoutConfirmStepProps {
  reservationMode: ReservationMode;
  logisticsLabel: string;
  tulipInsurance?: CheckoutTulipInsurance;
  tulipQuote: ReturnType<typeof useCheckoutTulipQuote>;
  advisorGate: ReturnType<typeof useCheckoutAdvisorGate>;
  promo: ReturnType<typeof useCheckoutPromo>;
  hasActivePromoCodes: boolean;
  totalDeposit: number;
  submitLabel: CheckoutSubmitLabel;
  blockedReason: CheckoutBlockedReason | null;
  advanceNoticeIssue: AdvanceNoticeIssueDisplay | null;
  isSubmitting: boolean;
  onBack: () => void;
  onEditContact: () => void;
  onEditDates: () => void;
  /** Direction the step flow moved in, for the entrance animation. */
  stepDirection: "forward" | "backward";
}

export const CheckoutConfirmStep = withForm({
  ...checkoutFormOptions,
  props: checkoutStepProps<CheckoutConfirmStepProps>(),
  render: ({
    form,
    reservationMode,
    logisticsLabel,
    tulipInsurance,
    tulipQuote,
    advisorGate,
    promo,
    hasActivePromoCodes,
    totalDeposit,
    submitLabel,
    blockedReason,
    advanceNoticeIssue,
    isSubmitting,
    onBack,
    onEditContact,
    onEditDates,
    stepDirection,
  }) => {
    const t = useTranslations("storefront.checkout");
    const formatMoney = useFormatMoney();
    const values = useStore(form.store, (state) => state.values);
    const submissionAttempts = useStore(form.store, (state) => state.submissionAttempts);

    const insuranceMode = tulipInsurance?.enabled ? tulipInsurance.mode : "no_public";
    const buttonLabel =
      submitLabel.kind === "request"
        ? t("submitRequest")
        : submitLabel.kind === "payDeposit"
          ? t("payDeposit", { amount: formatMoney(submitLabel.amount) })
          : t("payAmount", { amount: formatMoney(submitLabel.amount) });

    const blockedMessage = (() => {
      switch (blockedReason) {
        case "resolving":
        case "quoteLoading":
          return t("blocked.resolving");
        case "lineNeedsUpdate":
          return t("lineNeedsUpdate");
        case "advisorRequired":
          return t("advisor.completeVerificationHint");
        case "insuranceRequiredFailed":
          return t("blocked.insuranceRequired");
        case "advanceNotice":
          return t("advanceNotice.title");
        default:
          return null;
      }
    })();

    return (
      <>
        <StepContent className="flex flex-col gap-6" direction={stepDirection}>
          <h2 className="text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
            {t("steps.confirm")}
          </h2>

          <div className="flex flex-col gap-1 rounded-2xl bg-muted p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{t("customerInfo")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={onEditContact}
              >
                {t("modify")}
              </Button>
            </div>
            {values.isBusinessCustomer && values.companyName && (
              <p className="font-medium">{values.companyName}</p>
            )}
            <p>
              {values.firstName} {values.lastName}
            </p>
            <p className="text-muted-foreground">{values.email}</p>
            <p className="text-muted-foreground">{values.phone}</p>
            {values.address && (
              <p className="text-muted-foreground">
                {values.address}, {values.postalCode} {values.city}
              </p>
            )}
            {logisticsLabel && <p className="text-muted-foreground">{logisticsLabel}</p>}
          </div>

          {advanceNoticeIssue && (
            <Alert variant="warning">
              <AlertTitle>{t("advanceNotice.title")}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3">
                <p>
                  {t("advanceNotice.guidance", {
                    duration: advanceNoticeIssue.duration,
                    minimum: advanceNoticeIssue.minimumStart,
                  })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={onEditDates}
                >
                  {t("advanceNotice.editDates")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <CheckoutAdvisorGateCard gate={advisorGate} />
          {advisorGate.isRequired && <CheckoutAdvisorVerificationPanel gate={advisorGate} />}

          {insuranceMode !== "no_public" && (
            <form.Field name="tulipInsuranceOptIn">
              {(field) => (
                <InsuranceOptionCard
                  mode={insuranceMode}
                  preview={tulipQuote.preview}
                  isLoading={tulipQuote.isLoading}
                  isFetched={tulipQuote.isFetched}
                  quotedAmount={tulipQuote.quotedAmount}
                  checked={insuranceMode === "required" ? true : field.state.value}
                  onCheckedChange={field.handleChange}
                  fieldId={field.name}
                />
              )}
            </form.Field>
          )}

          {hasActivePromoCodes && (
            <CheckoutPromoCode
              promo={promo.promo}
              discountAmount={promo.discountAmount}
              isValidating={promo.isValidating}
              validationError={promo.validationError}
              onValidate={promo.validate}
              onRemove={promo.remove}
              onClearError={promo.clearError}
            />
          )}

          {/* Desktop repeats the deposit in the sticky summary; on phones that
            summary is collapsed, so this stays the only visible mention. */}
          {totalDeposit > 0 && (
            <div className="lg:hidden">
              <CheckoutDeposit amount={totalDeposit} reservationMode={reservationMode} />
            </div>
          )}

          <form.Field name="acceptCgv">
            {(field) => {
              const showError = submissionAttempts > 0 && field.state.meta.errors.length > 0;
              return (
                <div className="flex flex-col gap-1">
                  <div className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      id={field.name}
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(Boolean(checked))}
                      aria-invalid={showError}
                    />
                    <Label htmlFor={field.name} className="text-sm font-normal">
                      {t.rich("acceptCgvRich", {
                        terms: (chunks) => (
                          <StorefrontLink
                            href="/terms"
                            target="_blank"
                            className="underline underline-offset-2"
                          >
                            {chunks}
                          </StorefrontLink>
                        ),
                      })}
                    </Label>
                  </div>
                  {showError && (
                    <p className="text-xs text-destructive">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              );
            }}
          </form.Field>
        </StepContent>

        <CheckoutStepActions>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onBack}
            className="h-12 lg:h-10"
          >
            <ChevronLeft data-slot="icon" />
            {t("back")}
          </Button>
          <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1 lg:flex-none lg:items-end">
            <Button
              type="submit"
              id={CHECKOUT_SUBMIT_ID}
              size="lg"
              isPending={isSubmitting}
              pendingContent={t("processing")}
              disabled={blockedReason !== null}
              className="h-12 lg:h-10"
            >
              {submitLabel.kind === "request" ? (
                <Send data-slot="icon" />
              ) : (
                <CreditCard data-slot="icon" />
              )}
              {buttonLabel}
            </Button>
            {blockedMessage && <p className="text-xs text-muted-foreground">{blockedMessage}</p>}
          </div>
        </CheckoutStepActions>
      </>
    );
  },
});
