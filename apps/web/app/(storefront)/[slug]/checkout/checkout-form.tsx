'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, MapPin, Truck, User } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePostHog } from 'posthog-js/react';

import { StepContent, toastManager } from '@louez/ui';

import { DatePickerModal } from '@/components/storefront/date-picker-modal';

import {
  checkoutAnalyticsBaseProperties,
  productAnalyticsEvents,
} from '@/lib/product-analytics/analytics-events';

import { useAppForm } from '@/hooks/form/form';
import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { useAnalytics } from '@/contexts/analytics-context';
import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

import {
  getMinStartDateTime,
  validateAdvanceNotice,
} from '@/lib/utils/duration';
import { formatDurationFromMinutes } from '@/lib/utils/rental-duration';

import { createReservation, getTulipQuotePreview } from './actions';
import { CheckoutAdvisorGateCard } from './components/checkout-advisor-gate';
import { CheckoutAdvisorVerificationPanel } from './components/checkout-advisor-verification-panel';
import { CheckoutConfirmStep } from './components/checkout-confirm-step';
import { CheckoutContactStep } from './components/checkout-contact-step';
import { CheckoutDeliveryStep } from './components/checkout-delivery-step';
import { CheckoutEmptyCartState } from './components/checkout-empty-cart-state';
import { CheckoutOrderSummary } from './components/checkout-order-summary';
import { CheckoutWizardStepper } from './components/checkout-wizard-stepper';
import { useCheckoutAdvisorGate } from './hooks/use-checkout-advisor-gate';
import { useCheckoutDelivery } from './hooks/use-checkout-delivery';
import { useCheckoutLineResolutions } from './hooks/use-checkout-line-resolutions';
import { useCheckoutStepFlow } from './hooks/use-checkout-step-flow';
import type { ValidatedPromo } from './promo-actions';
import { buildReservationPayload } from './reservation-payload';
import type {
  CheckoutFormProps,
  CheckoutFormValues,
  CheckoutStep,
  StepId,
} from './types';
import { sanitizeTranslationParams } from './utils';
import { createCheckoutSchemaWithOptions } from './validation';

const STEP_ICONS: Record<StepId, CheckoutStep['icon']> = {
  contact: User,
  delivery: Truck,
  address: MapPin,
  confirm: Check,
};

const DEFAULT_VALUES: CheckoutFormValues = {
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  isBusinessCustomer: false,
  companyName: '',
  companyNumber: '',
  vatNumber: '',
  address: '',
  city: '',
  postalCode: '',
  notes: '',
  tulipInsuranceOptIn: true,
  acceptCgv: false,
};

const TULIP_CUSTOMER_INCOMPLETE_ERROR = 'errors.tulipCustomerDataIncomplete';
const ADVANCE_NOTICE_ERROR = 'errors.advanceNoticeViolation';

type TulipQuotePreviewState = Awaited<ReturnType<typeof getTulipQuotePreview>>;
type CheckoutSubmitErrorSource = 'client_validation' | 'server';

interface AdvanceNoticeIssue {
  source: CheckoutSubmitErrorSource;
  advanceNoticeMinutes: number;
  duration: string;
  failedStartDate: string | null;
  minimumStartTime: string;
}

function createEmptyTulipQuotePreview(
  mode: 'required' | 'optional' | 'no_public',
): TulipQuotePreviewState {
  return {
    mode,
    connected: false,
    inclusionEnabled: false,
    quoteUnavailable: false,
    quoteError: null,
    requestedOptIn: false,
    appliedOptIn: false,
    amount: 0,
    insuredProductCount: 0,
    uninsuredProductCount: 0,
    insuredProductIds: [],
    error: null,
  };
}

class CheckoutSubmitError extends Error {
  readonly params?: Record<string, string | number>;
  readonly source: CheckoutSubmitErrorSource;
  readonly minimumStartTime?: string;
  readonly advanceNoticeMinutes?: number;

  constructor(
    message: string,
    source: CheckoutSubmitErrorSource,
    params?: Record<string, string | number>,
    minimumStartTime?: string,
    advanceNoticeMinutes?: number,
  ) {
    super(message);
    this.name = 'CheckoutSubmitError';
    this.source = source;
    this.params = params;
    this.minimumStartTime = minimumStartTime;
    this.advanceNoticeMinutes = advanceNoticeMinutes;
  }
}

export function CheckoutForm({
  storeSlug,
  storeId,
  pricingMode,
  reservationMode,
  requireCustomerAddress,
  cgv,
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
  hasActivePromoCodes,
  advisorMode,
  businessHours,
  advanceNoticeMinutes,
  minRentalMinutes,
  timezone,
}: CheckoutFormProps) {
  const router = useRouter();
  const locale = useLocale() as 'fr' | 'en';
  const t = useTranslations('storefront.checkout');
  const tErrors = useTranslations('errors');
  const currency = useStoreCurrency();
  const { getUrl } = useStorefrontUrl(storeSlug);
  const posthog = usePostHog();
  const { trackEvent } = useAnalytics();
  const {
    items,
    isResolving: isCartResolving,
    clearCart,
    getSubtotal,
    getTotalDeposit,
    getTotal,
    globalStartDate,
    globalEndDate,
    getTotalSavings,
    getOriginalSubtotal,
  } = useCart();

  const subtotal = getSubtotal();
  const totalDeposit = getTotalDeposit();
  const total = getTotal();
  const totalSavings = getTotalSavings();
  const originalSubtotal = getOriginalSubtotal();

  const advisorGate = useCheckoutAdvisorGate(advisorMode ?? null);

  const [appliedPromo, setAppliedPromo] = useState<ValidatedPromo | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [advanceNoticeIssue, setAdvanceNoticeIssue] =
    useState<AdvanceNoticeIssue | null>(null);

  const discountAmount = useMemo(() => {
    if (!appliedPromo) return 0;
    if (appliedPromo.type === 'percentage') {
      return (
        Math.round(
          Math.min((subtotal * appliedPromo.value) / 100, subtotal) * 100,
        ) / 100
      );
    }
    return Math.round(Math.min(appliedPromo.value, subtotal) * 100) / 100;
  }, [appliedPromo, subtotal]);

  // Track checkout_started event on mount
  const checkoutStartedRef = useRef(false);
  useEffect(() => {
    if (items.length > 0 && !checkoutStartedRef.current) {
      checkoutStartedRef.current = true;
      trackEvent({
        eventType: 'checkout_started',
        metadata: {
          itemCount: items.length,
          subtotal,
        },
      });
    }
  }, [items.length, subtotal, trackEvent]);

  // Auto-remove promo code if subtotal drops below minimum amount
  useEffect(() => {
    if (!appliedPromo) return;
    if (
      appliedPromo.minimumAmount > 0 &&
      subtotal < appliedPromo.minimumAmount
    ) {
      setAppliedPromo(null);
      toastManager.add({ title: t('promoCode.minimumNotMet'), type: 'error' });
    }
  }, [appliedPromo, subtotal, t]);

  const handleApplyPromo = useCallback((promo: ValidatedPromo) => {
    setAppliedPromo(promo);
  }, []);

  const handleRemovePromo = useCallback(() => {
    setAppliedPromo(null);
  }, []);

  const {
    isDeliveryEnabled,
    isMultiLocationEnabled,
    isAddressDeliveryEnabled,
    locations: checkoutLocations,
    isDeliveryForced,
    isDeliveryIncluded,
    outboundMethod,
    pickupLocationId,
    handlePickupLocationChange,
    outboundAddress,
    outboundDistance,
    outboundFee,
    outboundError,
    handleOutboundMethodChange,
    handleOutboundAddressChange,
    returnMethod,
    returnLocationId,
    handleReturnLocationChange,
    returnAddress,
    returnDistance,
    returnFee,
    returnError,
    handleReturnMethodChange,
    handleReturnAddressChange,
    totalFee: deliveryTotalFee,
    canContinue: deliveryCanContinue,
    isDeliveryAmountEligible,
  } = useCheckoutDelivery({
    deliverySettings,
    storeLatitude,
    storeLongitude,
    subtotal,
    deliveryEligibilitySubtotal: subtotal - discountAmount,
    locations,
  });

  const totalWithDelivery = total - discountAmount + deliveryTotalFee;
  const tulipInsuranceMode = tulipInsurance?.mode ?? 'no_public';
  const selectedPickupLocation = checkoutLocations.find((location) => location.id === pickupLocationId)
    ?? checkoutLocations[0]
    ?? null;
  const selectedReturnLocation = checkoutLocations.find((location) => location.id === returnLocationId)
    ?? selectedPickupLocation;
  const logisticsLabel = (() => {
    const pickupLabel =
      outboundMethod === 'address'
        ? t('deliveryCompact')
        : selectedPickupLocation?.name ?? t('storeLocationFallback');
    const returnLabel =
      returnMethod === 'address'
        ? t('collectionCompact')
        : selectedReturnLocation?.name ?? pickupLabel;

    return pickupLabel === returnLabel ? pickupLabel : `${pickupLabel} -> ${returnLabel}`;
  })();

  const { lineResolutions, itemsWithResolved, canSubmitCheckout } =
    useCheckoutLineResolutions({
      items,
    });

  const checkoutSchema = useMemo(
    () =>
      createCheckoutSchemaWithOptions((key, params) => t(key, params), {
        requireAddress: requireCustomerAddress,
        country: storeCountry,
      }),
    [requireCustomerAddress, storeCountry, t],
  );

  const form = useAppForm({
    defaultValues: DEFAULT_VALUES,
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onSubmit: checkoutSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await createReservationMutation.mutateAsync(value);
      } catch {
        // Mutation errors are handled in onError callback.
      }
    },
  });

  const formValues = useStore(form.store, (state) => state.values);

  const tulipInsuranceOptIn = formValues.tulipInsuranceOptIn;

  const {
    currentStep,
    stepDirection,
    steps,
    currentStepIndex,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  } = useCheckoutStepFlow({
    isDeliveryEnabled,
    stepIcons: STEP_ICONS,
    validateCurrentStep: useCallback(
      async (step: StepId): Promise<boolean> => {
        if (step === 'contact') {
          const fieldsToValidate: Array<keyof CheckoutFormValues> = [
            'firstName',
            'lastName',
            'email',
            'phone',
          ];

          if (requireCustomerAddress) {
            fieldsToValidate.push('address', 'city', 'postalCode');
          }

          if (form.getFieldValue('isBusinessCustomer')) {
            fieldsToValidate.push('companyName', 'companyNumber', 'vatNumber');
          }

          await Promise.all(
            fieldsToValidate.map((fieldName) =>
              form.validateField(fieldName, 'submit'),
            ),
          );

          const failedFields = fieldsToValidate.filter(
            (fieldName) =>
              (form.getFieldMeta(fieldName)?.errors?.length ?? 0) > 0,
          );

          if (failedFields.length > 0) {
            posthog.capture(
              productAnalyticsEvents.checkoutStepValidationFailed,
              {
                ...checkoutAnalyticsBaseProperties,
                store_id: storeId,
                step,
                failed_fields: failedFields,
              },
            );
            return false;
          }

          return true;
        }

        if (step === 'confirm') {
          await form.validateField('acceptCgv', 'submit');
          const isValid =
            (form.getFieldMeta('acceptCgv')?.errors?.length ?? 0) === 0;

          if (!isValid) {
            posthog.capture(
              productAnalyticsEvents.checkoutStepValidationFailed,
              {
                ...checkoutAnalyticsBaseProperties,
                store_id: storeId,
                step,
                failed_fields: ['acceptCgv'],
              },
            );
          }

          return isValid;
        }

        return true;
      },
      [form, posthog, requireCustomerAddress, storeId],
    ),
  });

  useEffect(() => {
    if (items.length === 0) return;

    posthog.capture(productAnalyticsEvents.checkoutStepViewed, {
      ...checkoutAnalyticsBaseProperties,
      store_id: storeId,
      step: currentStep,
      step_index: currentStepIndex,
      steps_total: steps.length,
      direction: stepDirection,
    });
    // Only re-fire when the visible step actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, posthog, storeId]);

  const tulipQuoteCustomer = useMemo(() => {
    const customerType: 'business' | 'individual' =
      formValues.isBusinessCustomer ? 'business' : 'individual';

    return {
      customerType,
      companyName: formValues.isBusinessCustomer
        ? formValues.companyName
        : undefined,
      firstName: formValues.firstName,
      lastName: formValues.lastName,
      email: formValues.email,
      phone: formValues.phone,
      address: requireCustomerAddress ? formValues.address : undefined,
      city: requireCustomerAddress ? formValues.city : undefined,
      postalCode: requireCustomerAddress ? formValues.postalCode : undefined,
    };
  }, [
    formValues.address,
    formValues.city,
    formValues.companyName,
    formValues.email,
    formValues.firstName,
    formValues.isBusinessCustomer,
    formValues.lastName,
    formValues.phone,
    formValues.postalCode,
    requireCustomerAddress,
  ]);

  const tulipQuoteItems = useMemo(
    () =>
      itemsWithResolved
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }))
        .sort(
          (left, right) =>
            left.productId.localeCompare(right.productId) ||
            left.quantity - right.quantity,
        ),
    [itemsWithResolved],
  );

  const tulipQuoteRequest = useMemo(() => {
    if (
      !tulipInsurance?.enabled ||
      tulipInsuranceMode === 'no_public' ||
      currentStep !== 'confirm' ||
      !globalStartDate ||
      !globalEndDate ||
      tulipQuoteItems.length === 0
    ) {
      return null;
    }

    return {
      storeId,
      customer: tulipQuoteCustomer,
      items: tulipQuoteItems,
      startDate: globalStartDate,
      endDate: globalEndDate,
      tulipInsuranceOptIn,
    };
  }, [
    currentStep,
    globalEndDate,
    globalStartDate,
    storeId,
    tulipInsurance?.enabled,
    tulipInsuranceMode,
    tulipInsuranceOptIn,
    tulipQuoteCustomer,
    tulipQuoteItems,
  ]);

  const tulipQuoteQuery = useQuery({
    queryKey: ['checkout', 'tulip-quote-preview', tulipQuoteRequest],
    enabled: tulipQuoteRequest !== null,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!tulipQuoteRequest) {
        return createEmptyTulipQuotePreview(tulipInsuranceMode);
      }

      return getTulipQuotePreview(tulipQuoteRequest);
    },
  });

  const tulipQuotePreview = useMemo(() => {
    if (!tulipQuoteRequest) {
      return createEmptyTulipQuotePreview(tulipInsuranceMode);
    }

    if (tulipQuoteQuery.data) {
      return tulipQuoteQuery.data;
    }

    if (tulipQuoteQuery.isError) {
      return {
        ...createEmptyTulipQuotePreview(tulipInsuranceMode),
        mode: tulipInsuranceMode,
        quoteUnavailable: true,
        quoteError: 'errors.tulipQuoteFailed',
        error: 'errors.tulipQuoteFailed',
      };
    }

    return createEmptyTulipQuotePreview(tulipInsuranceMode);
  }, [
    tulipInsuranceMode,
    tulipQuoteQuery.data,
    tulipQuoteQuery.isError,
    tulipQuoteRequest,
  ]);

  const isTulipQuoteLoading =
    tulipQuoteRequest !== null &&
    (tulipQuoteQuery.isLoading ||
      (tulipQuoteQuery.isFetching && !tulipQuoteQuery.data));

  const isTulipQuoteFetched =
    tulipQuoteQuery.data !== undefined || tulipQuoteQuery.isError;

  useEffect(() => {
    if (
      tulipQuotePreview.mode === 'optional' &&
      tulipQuotePreview.quoteUnavailable &&
      form.getFieldValue('tulipInsuranceOptIn') &&
      tulipQuotePreview.quoteError !== TULIP_CUSTOMER_INCOMPLETE_ERROR
    ) {
      form.setFieldValue('tulipInsuranceOptIn', false);
    }
  }, [
    form,
    tulipQuotePreview.mode,
    tulipQuotePreview.quoteError,
    tulipQuotePreview.quoteUnavailable,
  ]);

  const estimatedTulipInsuranceAmount =
    tulipQuotePreview.appliedOptIn && tulipQuotePreview.amount > 0
      ? tulipQuotePreview.amount
      : 0;

  const subtotalWithEstimatedInsurance =
    subtotal + estimatedTulipInsuranceAmount;
  const totalWithEstimatedInsurance =
    totalWithDelivery + estimatedTulipInsuranceAmount;

  const canSubmitCheckoutWithTulip =
    canSubmitCheckout &&
    !isCartResolving &&
    !isTulipQuoteLoading &&
    !(
      tulipInsurance?.enabled &&
      tulipQuotePreview.mode === 'required' &&
      Boolean(tulipQuotePreview.error)
    );

  useEffect(() => {
    if (!advanceNoticeIssue || !globalStartDate) return;
    if (globalStartDate === advanceNoticeIssue.failedStartDate) return;

    const validation = validateAdvanceNotice(
      new Date(globalStartDate),
      advanceNoticeIssue.advanceNoticeMinutes,
    );
    if (!validation.valid) return;

    posthog.capture(productAnalyticsEvents.checkoutValidationRecovered, {
      ...checkoutAnalyticsBaseProperties,
      store_id: storeId,
      error_code: ADVANCE_NOTICE_ERROR,
      original_failure_source: advanceNoticeIssue.source,
      recovery_action: 'dates_changed',
    });
    setAdvanceNoticeIssue(null);
  }, [
    advanceNoticeIssue,
    globalStartDate,
    posthog,
    storeId,
  ]);

  const createReservationMutation = useMutation({
    mutationFn: async (value: CheckoutFormValues) => {
      if (items.length === 0) {
        throw new CheckoutSubmitError('emptyCart', 'client_validation');
      }
      if (!canSubmitCheckoutWithTulip) {
        throw new CheckoutSubmitError('lineNeedsUpdate', 'client_validation');
      }
      // Client-side mirror of the server-enforced advisor gate
      if (advisorGate.isRequired && !advisorGate.isValidated) {
        throw new CheckoutSubmitError(
          'errors.advisorValidationRequired',
          'client_validation',
        );
      }

      if (globalStartDate) {
        const advanceNoticeValidation = validateAdvanceNotice(
          new Date(globalStartDate),
          advanceNoticeMinutes,
        );
        if (!advanceNoticeValidation.valid) {
          throw new CheckoutSubmitError(
            ADVANCE_NOTICE_ERROR,
            'client_validation',
            {
              duration: formatDurationFromMinutes(advanceNoticeMinutes),
            },
            advanceNoticeValidation.minimumStartTime.toISOString(),
            advanceNoticeMinutes,
          );
        }
      }

      const payload = buildReservationPayload({
        storeId,
        pricingMode,
        locale,
        values: value,
        items: itemsWithResolved,
        subtotalAmount: subtotalWithEstimatedInsurance,
        depositAmount: totalDeposit,
        totalAmount: totalWithEstimatedInsurance,
        outboundMethod,
        outboundAddress,
        pickupLocationId,
        returnMethod,
        returnAddress,
        returnLocationId,
        tulipInsuranceMode,
        promoCode: appliedPromo?.code,
        advisorConversationId: advisorGate.conversationId ?? undefined,
      });

      const result = await createReservation(payload);

      if (result.error) {
        const errorParams = sanitizeTranslationParams(result.errorParams);
        const serverAdvanceNoticeMinutes =
          typeof errorParams.advanceNoticeMinutes === 'number'
            ? errorParams.advanceNoticeMinutes
            : advanceNoticeMinutes;
        const serverMinimumStartTime =
          typeof errorParams.minimumStartTime === 'string'
            ? errorParams.minimumStartTime
            : getMinStartDateTime(serverAdvanceNoticeMinutes).toISOString();

        throw new CheckoutSubmitError(
          result.error,
          'server',
          errorParams,
          result.error === ADVANCE_NOTICE_ERROR
            ? serverMinimumStartTime
            : undefined,
          result.error === ADVANCE_NOTICE_ERROR
            ? serverAdvanceNoticeMinutes
            : undefined,
        );
      }

      return result;
    },
    onSuccess: (result) => {
      setAdvanceNoticeIssue(null);

      // Track checkout_completed event
      trackEvent({
        eventType: 'checkout_completed',
        metadata: {
          reservationId: result.reservationId,
          itemCount: items.length,
          subtotal,
          total: totalWithEstimatedInsurance,
          reservationMode,
        },
      });

      // Captured client-side so the PostHog funnel keeps the browser's
      // distinct_id; the server-side checkout_reservation_created event is
      // attributed to the customer id and would break the funnel chain.
      posthog.capture(productAnalyticsEvents.checkoutCompleted, {
        ...checkoutAnalyticsBaseProperties,
        store_id: storeId,
        reservation_id: result.reservationId,
        reservation_mode: reservationMode,
        item_count: items.length,
        subtotal_amount_cents: Math.round(subtotal * 100),
        total_amount_cents: Math.round(totalWithEstimatedInsurance * 100),
      });

      clearCart();

      if (reservationMode === 'payment' && result.paymentUrl) {
        // Track payment_initiated for Stripe redirect
        trackEvent({
          eventType: 'payment_initiated',
          metadata: {
            reservationId: result.reservationId,
            amount: totalWithEstimatedInsurance,
          },
        });
        window.location.href = result.paymentUrl;
        return;
      }

      toastManager.add({ title: t('requestSent'), type: 'success' });
      router.push(getUrl(`/confirmation/${result.reservationId}`));
    },
    onError: (error) => {
      if (
        error instanceof CheckoutSubmitError &&
        error.message === ADVANCE_NOTICE_ERROR
      ) {
        setAdvanceNoticeIssue({
          source: error.source,
          advanceNoticeMinutes:
            error.advanceNoticeMinutes ?? advanceNoticeMinutes,
          duration:
            typeof error.params?.duration === 'string'
              ? error.params.duration
              : formatDurationFromMinutes(
                  error.advanceNoticeMinutes ?? advanceNoticeMinutes,
                ),
          failedStartDate: globalStartDate,
          minimumStartTime:
            error.minimumStartTime ??
            getMinStartDateTime(
              error.advanceNoticeMinutes ?? advanceNoticeMinutes,
            ).toISOString(),
        });

        if (error.source === 'client_validation') {
          posthog.capture(
            productAnalyticsEvents.checkoutStepValidationFailed,
            {
              ...checkoutAnalyticsBaseProperties,
              store_id: storeId,
              step: 'confirm',
              failed_fields: ['rentalStartDate'],
              error_code: ADVANCE_NOTICE_ERROR,
              validation_type: 'advance_notice',
            },
          );
        } else {
          posthog.capture(productAnalyticsEvents.checkoutSubmitFailed, {
            ...checkoutAnalyticsBaseProperties,
            store_id: storeId,
            error_code: ADVANCE_NOTICE_ERROR,
            failure_source: 'server',
          });
        }
        return;
      }

      posthog.capture(productAnalyticsEvents.checkoutSubmitFailed, {
        ...checkoutAnalyticsBaseProperties,
        store_id: storeId,
        error_code:
          error instanceof CheckoutSubmitError ? error.message : 'unknown',
        failure_source:
          error instanceof CheckoutSubmitError ? error.source : 'unknown',
      });

      if (error instanceof CheckoutSubmitError) {
        if (error.message === 'emptyCart') {
          toastManager.add({ title: t('emptyCart'), type: 'error' });
          return;
        }
        if (error.message === 'lineNeedsUpdate') {
          toastManager.add({ title: t('lineNeedsUpdate'), type: 'error' });
          return;
        }

        if (error.message.startsWith('errors.')) {
          const key = error.message.replace('errors.', '');
          toastManager.add({
            title: tErrors(key, error.params),
            type: 'error',
          });
          return;
        }

        toastManager.add({ title: error.message, type: 'error' });
        return;
      }

      toastManager.add({ title: tErrors('generic'), type: 'error' });
    },
  });

  const advanceNoticeDisplay = advanceNoticeIssue
    ? {
        duration: advanceNoticeIssue.duration,
        minimumStart: new Intl.DateTimeFormat(
          locale === 'fr' ? 'fr-FR' : 'en-US',
          {
            dateStyle: 'long',
            timeStyle: 'short',
            ...(timezone ? { timeZone: timezone } : {}),
          },
        ).format(new Date(advanceNoticeIssue.minimumStartTime)),
      }
    : undefined;

  const isBusinessCustomer = formValues.isBusinessCustomer;

  const handleBusinessCustomerUnchecked = useCallback(() => {
    form.setFieldValue('companyName', '');
    form.setFieldValue('companyNumber', '');
    form.setFieldValue('vatNumber', '');
  }, [form]);

  if (items.length === 0) {
    return <CheckoutEmptyCartState storeSlug={storeSlug} />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <CheckoutWizardStepper
        steps={steps}
        currentStep={currentStep}
        onStepClick={goToStep}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <form.AppForm>
            <form.Form>
              <StepContent direction={stepDirection}>
                {currentStep === 'contact' && (
                  <CheckoutContactStep
                    form={form}
                    storeId={storeId}
                    storeCountry={storeCountry}
                    showAddressFields={requireCustomerAddress}
                    isBusinessCustomer={isBusinessCustomer}
                    onBusinessCustomerUnchecked={handleBusinessCustomerUnchecked}
                    onContinue={goToNextStep}
                  />
                )}

                {currentStep === 'delivery' &&
                  isDeliveryEnabled &&
                  deliverySettings && (
                    <CheckoutDeliveryStep
                      deliverySettings={deliverySettings}
                      subtotal={subtotal}
                      currency={currency}
                      storeAddress={storeAddress}
                      storeName={storeName}
                      isMultiLocationEnabled={isMultiLocationEnabled}
                      isAddressDeliveryEnabled={isAddressDeliveryEnabled}
                      locations={checkoutLocations}
                      isDeliveryForced={isDeliveryForced}
                      isDeliveryIncluded={isDeliveryIncluded}
                      isDeliveryAmountEligible={isDeliveryAmountEligible}
                      outboundMethod={outboundMethod}
                      pickupLocationId={pickupLocationId}
                      outboundAddress={outboundAddress}
                      outboundDistance={outboundDistance}
                      outboundFee={outboundFee}
                      outboundError={outboundError}
                      onOutboundMethodChange={handleOutboundMethodChange}
                      onPickupLocationChange={handlePickupLocationChange}
                      onOutboundAddressChange={handleOutboundAddressChange}
                      returnMethod={returnMethod}
                      returnLocationId={returnLocationId}
                      returnAddress={returnAddress}
                      returnDistance={returnDistance}
                      returnFee={returnFee}
                      returnError={returnError}
                      onReturnMethodChange={handleReturnMethodChange}
                      onReturnLocationChange={handleReturnLocationChange}
                      onReturnAddressChange={handleReturnAddressChange}
                      totalFee={deliveryTotalFee}
                      canContinue={deliveryCanContinue}
                      onBack={goToPreviousStep}
                      onContinue={goToNextStep}
                    />
                  )}

                {currentStep === 'confirm' && (
                  <>
                    <CheckoutAdvisorGateCard gate={advisorGate} />
                    {advisorGate.isRequired && (
                      <CheckoutAdvisorVerificationPanel gate={advisorGate} />
                    )}
                    <CheckoutConfirmStep
                      form={form}
                      cgv={cgv}
                      hasDeliveryLegs={
                        outboundMethod === 'address' ||
                        returnMethod === 'address'
                      }
                      logisticsLabel={logisticsLabel}
                      reservationMode={reservationMode}
                      depositPercentage={depositPercentage}
                      subtotal={subtotalWithEstimatedInsurance}
                      totalWithDelivery={totalWithEstimatedInsurance}
                      currency={currency}
                      tulipInsurance={tulipInsurance}
                      canSubmitCheckout={
                        canSubmitCheckoutWithTulip &&
                        (!advisorGate.isRequired || advisorGate.isValidated) &&
                        !advanceNoticeIssue
                      }
                      showVerificationHint={
                        advisorGate.isRequired && !advisorGate.isValidated
                      }
                      discountAmount={discountAmount}
                      onBack={goToPreviousStep}
                      onEditContact={() => goToStep('contact')}
                      advanceNoticeIssue={advanceNoticeDisplay}
                      onEditDates={() => setIsDatePickerOpen(true)}
                    />
                  </>
                )}
              </StepContent>
            </form.Form>
          </form.AppForm>
        </div>

        <CheckoutOrderSummary
          items={itemsWithResolved}
          pricingMode={pricingMode}
          reservationMode={reservationMode}
          depositPercentage={depositPercentage}
          taxSettings={taxSettings}
          currency={currency}
          locale={locale}
          globalStartDate={globalStartDate}
          globalEndDate={globalEndDate}
          subtotal={subtotal}
          originalSubtotal={originalSubtotal}
          totalSavings={totalSavings}
          totalDeposit={totalDeposit}
          totalWithDelivery={totalWithDelivery}
          hasDeliveryLegs={
            outboundMethod === 'address' || returnMethod === 'address'
          }
          deliveryFee={deliveryTotalFee}
          tulipInsurance={tulipInsurance}
          tulipInsuranceOptIn={tulipInsuranceOptIn}
          isTulipQuoteLoading={isTulipQuoteLoading}
          isTulipQuoteFetched={isTulipQuoteFetched}
          tulipQuotePreview={tulipQuotePreview}
          lineResolutions={lineResolutions}
          hasActivePromoCodes={hasActivePromoCodes}
          storeId={storeId}
          appliedPromo={appliedPromo}
          discountAmount={discountAmount}
          onApplyPromo={handleApplyPromo}
          onRemovePromo={handleRemovePromo}
          onEditDates={() => setIsDatePickerOpen(true)}
        />
      </div>

      <DatePickerModal
        storeSlug={storeSlug}
        pricingMode={pricingMode}
        businessHours={businessHours}
        advanceNotice={
          advanceNoticeIssue?.advanceNoticeMinutes ?? advanceNoticeMinutes
        }
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
}
