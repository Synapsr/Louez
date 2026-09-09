"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStore } from "@tanstack/react-form";
import { AlertCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";

import { Alert, AlertDescription, AlertTitle, Button, StepContent } from "@louez/ui";

import { cn } from "@louez/utils";

import { DatePickerModal } from "@/components/storefront/date-picker-modal";
import { BackLink } from "@/components/storefront/ui/back-link";
import { useAnalytics } from "@/contexts/analytics-context";
import { useCart } from "@/contexts/cart-context";
import { useAppForm } from "@/hooks/form/form";
import { defaultLocale } from "@/i18n/config";
import { isLocale } from "@/lib/i18n/format-locale";
import {
  checkoutAnalyticsBaseProperties,
  productAnalyticsEvents,
} from "@/lib/product-analytics/analytics-events";

import type {
  CheckoutBlockedReason,
  CheckoutFormProps,
  CheckoutFormValues,
  CheckoutInitialCustomer,
  DeliveryAddress,
  StepId,
} from "./checkout.types";
import { CheckoutConfirmStep } from "./components/checkout-confirm-step";
import { CheckoutContactStep } from "./components/checkout-contact-step";
import { CheckoutDeliveryStep } from "./components/checkout-delivery-step";
import { CheckoutEmptyCartState } from "./components/checkout-empty-cart-state";
import { CheckoutOrderSummary } from "./components/checkout-order-summary";
import { CheckoutSummaryBar } from "./components/checkout-summary-bar";
import { useCheckoutAdvanceNotice } from "./hooks/use-checkout-advance-notice";
import { useCheckoutAdvisorGate } from "./hooks/use-checkout-advisor-gate";
import { useCheckoutDelivery } from "./hooks/use-checkout-delivery";
import { useCheckoutLineResolutions } from "./hooks/use-checkout-line-resolutions";
import { useCheckoutPromo } from "./hooks/use-checkout-promo";
import { useCheckoutStepFlow } from "./hooks/use-checkout-step-flow";
import { useCheckoutSubmit } from "./hooks/use-checkout-submit";
import { useCheckoutTulipQuote } from "./hooks/use-checkout-tulip-quote";
import { calculateCheckoutTotals, getCheckoutSubmitLabel } from "./util.checkout-totals";
import {
  checkoutFormOptions,
  createCheckoutValidator,
  getCheckoutDefaultValues,
} from "./validator.checkout";

type Coordinates = Pick<DeliveryAddress, "latitude" | "longitude">;

const NO_COORDINATES: Coordinates = { latitude: null, longitude: null };

const CONTACT_FIELDS: Array<keyof CheckoutFormValues> = ["email", "firstName", "lastName", "phone"];
const ADDRESS_FIELDS: Array<keyof CheckoutFormValues> = ["address", "city", "postalCode"];
const COMPANY_FIELDS: Array<keyof CheckoutFormValues> = [
  "companyName",
  "companyNumber",
  "vatNumber",
];

export const CheckoutForm = ({
  storeSlug,
  storeId,
  pricingMode,
  reservationMode,
  requireCustomerAddress,
  taxSettings,
  depositPercentage = 100,
  deliverySettings,
  storeAddress,
  storeLatitude,
  storeLongitude,
  storeName,
  storeCountry,
  locations,
  tulipInsurance,
  hasActivePromoCodes = false,
  advisorMode,
  businessHours,
  advanceNoticeMinutes,
  minRentalMinutes,
  timezone,
  initialCustomer,
}: CheckoutFormProps) => {
  const t = useTranslations("storefront.checkout");
  const tErrors = useTranslations("errors");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const posthog = usePostHog();
  const { trackEvent } = useAnalytics();
  const {
    items,
    isResolving,
    getSubtotal,
    getTotalDeposit,
    globalStartDate,
    globalEndDate,
    getDisplayableSavings,
  } = useCart();

  const subtotal = getSubtotal();
  const totalDeposit = getTotalDeposit();
  const { savings: totalSavings, originalSubtotal } = getDisplayableSavings();

  const [sessionCustomer, setSessionCustomer] = useState<CheckoutInitialCustomer | null>(
    initialCustomer,
  );
  const [coordinates, setCoordinates] = useState<Coordinates>(NO_COORDINATES);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const stepRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<(values: CheckoutFormValues) => Promise<void>>(async () => undefined);

  const advisorGate = useCheckoutAdvisorGate(advisorMode ?? null);
  const promo = useCheckoutPromo({ items, subtotal });
  const delivery = useCheckoutDelivery({
    deliverySettings,
    storeLatitude,
    storeLongitude,
    subtotal,
    deliveryEligibilitySubtotal: subtotal - promo.discountAmount,
    locations,
  });
  const { lineResolutions, itemsWithResolved, hasInvalidLines, hasUnresolvedLines } =
    useCheckoutLineResolutions({
      items,
    });

  const validator = useMemo(
    () =>
      createCheckoutValidator((key, params) => t(key, params), {
        requireAddress: requireCustomerAddress,
        country: storeCountry,
      }),
    [requireCustomerAddress, storeCountry, t],
  );

  const form = useAppForm({
    ...checkoutFormOptions,
    defaultValues: getCheckoutDefaultValues(initialCustomer),
    validators: { onSubmit: validator },
    onSubmit: async ({ value }) => submitRef.current(value),
  });

  const values = useStore(form.store, (state) => state.values);
  const showAddressInContact = requireCustomerAddress;

  const validateCurrentStep = useCallback(
    async (step: StepId): Promise<boolean> => {
      if (step === "confirm") return true;

      const fields = [
        ...(step === "contact" ? CONTACT_FIELDS : []),
        ...(step === "contact" && showAddressInContact ? ADDRESS_FIELDS : []),
        ...(step === "contact" && form.getFieldValue("isBusinessCustomer") ? COMPANY_FIELDS : []),
      ];

      await Promise.all(fields.map((field) => form.validateField(field, "submit")));
      const failedFields = fields.filter(
        (field) => (form.getFieldMeta(field)?.errors?.length ?? 0) > 0,
      );

      if (failedFields.length > 0) {
        posthog.capture(productAnalyticsEvents.checkoutStepValidationFailed, {
          ...checkoutAnalyticsBaseProperties,
          store_id: storeId,
          step,
          failed_fields: failedFields,
        });
        return false;
      }
      return true;
    },
    [form, posthog, showAddressInContact, storeId],
  );

  const stepFlow = useCheckoutStepFlow({
    isDeliveryEnabled: delivery.isDeliveryEnabled,
    validateCurrentStep,
    scrollTargetRef: stepRef,
  });

  const tulipQuote = useCheckoutTulipQuote({
    storeId,
    tulipInsurance,
    isActive: !isResolving && !hasUnresolvedLines && !hasInvalidLines,
    items: itemsWithResolved,
    startDate: globalStartDate,
    endDate: globalEndDate,
    values,
    requireCustomerAddress,
  });

  const advanceNotice = useCheckoutAdvanceNotice({
    startDate: globalStartDate,
    advanceNoticeMinutes,
    timezone,
  });

  const totals = useMemo(
    () =>
      calculateCheckoutTotals({
        subtotal,
        discountAmount: promo.discountAmount,
        deliveryFee: delivery.totalFee,
        insuranceAmount: tulipQuote.appliedAmount,
        depositPercentage,
        reservationMode,
      }),
    [
      delivery.totalFee,
      depositPercentage,
      promo.discountAmount,
      reservationMode,
      subtotal,
      tulipQuote.appliedAmount,
    ],
  );
  const submitLabel = getCheckoutSubmitLabel(totals, reservationMode);

  const blockedReason: CheckoutBlockedReason | null = hasInvalidLines
    ? "lineNeedsUpdate"
    : hasUnresolvedLines || isResolving
      ? "resolving"
      : tulipQuote.isLoading
        ? "quoteLoading"
        : tulipQuote.isRequiredAndFailed
          ? "insuranceRequiredFailed"
          : advisorGate.isRequired && !advisorGate.isValidated
            ? "advisorRequired"
            : advanceNotice.issue
              ? "advanceNotice"
              : null;

  const { submit, isSubmitting, serverError, clearServerError } = useCheckoutSubmit({
    storeId,
    storeSlug,
    reservationMode,
    locale,
    items: itemsWithResolved,
    subtotal,
    totals,
    totalDeposit,
    delivery,
    isDeliveryEnabled: delivery.isDeliveryEnabled,
    tulipInsuranceMode: tulipQuote.mode,
    promoCode: promo.promo?.code,
    advisorConversationId: advisorGate.conversationId ?? undefined,
    blockedReason,
    onAdvanceNoticeRejected: advanceNotice.reportServerIssue,
  });

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const checkoutStartedRef = useRef(false);
  useEffect(() => {
    if (items.length === 0 || checkoutStartedRef.current) return;
    checkoutStartedRef.current = true;
    trackEvent({ eventType: "checkout_started", metadata: { itemCount: items.length, subtotal } });
  }, [items.length, subtotal, trackEvent]);

  useEffect(() => {
    if (items.length === 0) return;
    posthog.capture(productAnalyticsEvents.checkoutStepViewed, {
      ...checkoutAnalyticsBaseProperties,
      store_id: storeId,
      step: stepFlow.currentStep,
      step_index: stepFlow.currentStepIndex,
      steps_total: stepFlow.steps.length,
      direction: stepFlow.stepDirection,
    });
    // Only re-fire when the visible step actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepFlow.currentStep, posthog, storeId]);

  const handleSessionCustomer = (customer: CheckoutInitialCustomer | null) => {
    setSessionCustomer(customer);
    setCoordinates(NO_COORDINATES);
    form.reset(getCheckoutDefaultValues(customer));
  };

  const handleUseCustomerAddress = (leg: "outbound" | "return") => {
    const legAddress = leg === "outbound" ? delivery.outboundAddress : delivery.returnAddress;
    if (
      legAddress.address ||
      !values.address ||
      coordinates.latitude === null ||
      coordinates.longitude === null
    ) {
      return;
    }
    const change =
      leg === "outbound"
        ? delivery.handleOutboundAddressChange
        : delivery.handleReturnAddressChange;
    change(values.address, coordinates.latitude, coordinates.longitude);
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || stepFlow.isLastStep) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.getAttribute("role") === "combobox") return;
    event.preventDefault();
    void stepFlow.goToNextStep();
  };

  if (items.length === 0) {
    return <CheckoutEmptyCartState />;
  }

  const selectedPickupLocation =
    delivery.locations.find((location) => location.id === delivery.pickupLocationId) ??
    delivery.locations[0] ??
    null;
  const selectedReturnLocation =
    delivery.locations.find((location) => location.id === delivery.returnLocationId) ??
    selectedPickupLocation;
  const pickupLabel =
    delivery.outboundMethod === "address"
      ? t("deliveryCompact")
      : (selectedPickupLocation?.name ?? t("storeLocationFallback"));
  const returnLabel =
    delivery.returnMethod === "address"
      ? t("collectionCompact")
      : (selectedReturnLocation?.name ?? pickupLabel);
  const logisticsLabel =
    pickupLabel === returnLabel ? pickupLabel : `${pickupLabel} → ${returnLabel}`;

  const serverErrorMessage = serverError
    ? serverError.message.startsWith("errors.")
      ? tErrors(serverError.message.slice("errors.".length), serverError.params)
      : serverError.message === "emptyCart"
        ? t("emptyCart")
        : serverError.message === "lineNeedsUpdate"
          ? t("lineNeedsUpdate")
          : tErrors("generic")
    : null;

  const summaryProps = {
    items: itemsWithResolved,
    reservationMode,
    taxSettings,
    globalStartDate,
    globalEndDate,
    subtotal,
    originalSubtotal,
    totalSavings,
    totalDeposit,
    totals,
    hasDeliveryLegs: delivery.outboundMethod === "address" || delivery.returnMethod === "address",
    deliveryFee: delivery.totalFee,
    deliveryFeeReady: delivery.canContinue,
    tulipInsurance,
    tulipQuote,
    tulipInsuranceOptIn: values.tulipInsuranceOptIn,
    lineResolutions,
    promo: promo.promo,
    discountAmount: promo.discountAmount,
    onEditDates: () => setIsDatePickerOpen(true),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackLink href="/catalog" />
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
          {t("title")}
        </h1>
      </div>

      <CheckoutSummaryBar {...summaryProps} />

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={stepFlow.steps.length}
        aria-valuenow={stepFlow.currentStepIndex + 1}
        aria-label={t("title")}
        aria-valuetext={
          stepFlow.currentStep === "delivery"
            ? t("fulfillmentTitle")
            : t(`steps.${stepFlow.currentStep}`)
        }
        className="flex gap-1.5"
      >
        {stepFlow.steps.map((id, index) => (
          <div
            key={id}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-500 motion-reduce:transition-none",
              index <= stepFlow.currentStepIndex ? "bg-foreground" : "bg-border",
            )}
          />
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div ref={stepRef} className="min-w-0 scroll-mt-4">
          {serverError && serverErrorMessage && (
            <Alert variant="error" className="mb-4">
              <AlertCircle />
              <AlertTitle>{t("submitError.title")}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{serverErrorMessage}</span>
                {serverError.step !== stepFlow.currentStep && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      stepFlow.goToStep(serverError.step);
                      clearServerError();
                    }}
                  >
                    {t("submitError.goToStep")}
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          <form.AppForm>
            <form.Form formName="checkout" onKeyDown={handleFormKeyDown}>
              <StepContent key={stepFlow.currentStep} direction={stepFlow.stepDirection}>
                {stepFlow.currentStep === "contact" && (
                  <CheckoutContactStep
                    form={form}
                    storeId={storeId}
                    storeCountry={storeCountry}
                    showAddressFields={showAddressInContact}
                    sessionCustomer={sessionCustomer}
                    onSessionCustomer={handleSessionCustomer}
                    coordinates={coordinates}
                    onCoordinatesChange={setCoordinates}
                    onContinue={stepFlow.goToNextStep}
                  />
                )}

                {stepFlow.currentStep === "delivery" && deliverySettings && (
                  <CheckoutDeliveryStep
                    form={form}
                    deliverySettings={deliverySettings}
                    delivery={delivery}
                    subtotal={subtotal}
                    storeAddress={storeAddress}
                    storeName={storeName}
                    storeLatitude={storeLatitude}
                    storeLongitude={storeLongitude}
                    onUseCustomerAddress={handleUseCustomerAddress}
                    onBack={stepFlow.goToPreviousStep}
                    onContinue={stepFlow.goToNextStep}
                  />
                )}

                {stepFlow.currentStep === "confirm" && (
                  <CheckoutConfirmStep
                    form={form}
                    reservationMode={reservationMode}
                    logisticsLabel={logisticsLabel}
                    tulipInsurance={tulipInsurance}
                    tulipQuote={tulipQuote}
                    advisorGate={advisorGate}
                    promo={promo}
                    hasActivePromoCodes={hasActivePromoCodes}
                    totalDeposit={totalDeposit}
                    submitLabel={submitLabel}
                    blockedReason={blockedReason}
                    advanceNoticeIssue={advanceNotice.issue}
                    isSubmitting={isSubmitting}
                    onBack={stepFlow.goToPreviousStep}
                    onEditContact={() => stepFlow.goToStep("contact")}
                    onEditDates={() => setIsDatePickerOpen(true)}
                  />
                )}
              </StepContent>
            </form.Form>
          </form.AppForm>
        </div>

        <aside className="hidden lg:sticky lg:top-4 lg:block">
          <CheckoutOrderSummary {...summaryProps} />
        </aside>
      </div>

      <DatePickerModal
        storeSlug={storeSlug}
        pricingMode={pricingMode}
        businessHours={businessHours}
        advanceNotice={advanceNotice.issue?.advanceNoticeMinutes ?? advanceNoticeMinutes}
        minRentalMinutes={minRentalMinutes}
        timezone={timezone}
        isOpen={isDatePickerOpen}
        onClose={() => setIsDatePickerOpen(false)}
        initialStartDate={globalStartDate ?? undefined}
        initialEndDate={globalEndDate ?? undefined}
        redirectOnSubmit={false}
      />
    </div>
  );
};
