'use client';

import { useCallback, useEffect, useMemo } from 'react';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, MapPin, Truck, User } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { StepContent, toastManager } from '@louez/ui';

import { useAppForm } from '@/hooks/form/form';
import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

import { createReservation, getTulipQuotePreview } from './actions';
import { buildReservationPayload } from './reservation-payload';
import type {
  CheckoutFormProps,
  CheckoutFormValues,
  CheckoutStep,
  StepId,
} from './types';
import { createCheckoutSchemaWithOptions } from './validation';
import { sanitizeTranslationParams } from './utils';
import { CheckoutConfirmStep } from './components/checkout-confirm-step';
import { CheckoutContactStep } from './components/checkout-contact-step';
import { CheckoutDeliveryStep } from './components/checkout-delivery-step';
import { CheckoutEmptyCartState } from './components/checkout-empty-cart-state';
import { CheckoutOrderSummary } from './components/checkout-order-summary';
import { CheckoutWizardStepper } from './components/checkout-wizard-stepper';
import { useCheckoutDelivery } from './hooks/use-checkout-delivery';
import { useCheckoutLineResolutions } from './hooks/use-checkout-line-resolutions';
import { useCheckoutStepFlow } from './hooks/use-checkout-step-flow';

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
  address: '',
  city: '',
  postalCode: '',
  notes: '',
  tulipInsuranceOptIn: true,
  acceptCgv: false,
};

const TULIP_CUSTOMER_INCOMPLETE_ERROR = 'errors.tulipCustomerDataIncomplete';

type TulipQuotePreviewState = Awaited<ReturnType<typeof getTulipQuotePreview>>;

function createEmptyTulipQuotePreview(
  mode: 'required' | 'optional' | 'no_public',
): TulipQuotePreviewState {
  return {
    mode,
    connected: false,
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

  constructor(message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'CheckoutSubmitError';
    this.params = params;
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
  tulipInsurance,
}: CheckoutFormProps) {
  const router = useRouter();
  const locale = useLocale() as 'fr' | 'en';
  const t = useTranslations('storefront.checkout');
  const tErrors = useTranslations('errors');
  const currency = useStoreCurrency();
  const { getUrl } = useStorefrontUrl(storeSlug);
  const {
    items,
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

  const {
    isDeliveryEnabled,
    isDeliveryForced,
    isDeliveryIncluded,
    deliveryOption,
    deliveryAddress,
    deliveryDistance,
    deliveryFee,
    deliveryError,
    handleDeliveryOptionChange,
    handleDeliveryAddressChange,
  } = useCheckoutDelivery({
    deliverySettings,
    storeLatitude,
    storeLongitude,
    subtotal,
  });

  const totalWithDelivery =
    total + (deliveryOption === 'delivery' ? deliveryFee : 0);
  const tulipInsuranceMode = tulipInsurance?.mode ?? 'no_public';

  const {
    lineResolutions,
    itemsWithResolved,
    canSubmitCheckout,
  } = useCheckoutLineResolutions({
    items,
  });

  const checkoutSchema = useMemo(
    () =>
      createCheckoutSchemaWithOptions((key, params) => t(key, params), {
        requireAddress: requireCustomerAddress,
      }),
    [requireCustomerAddress, t],
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
            fieldsToValidate.push('companyName');
          }

          await Promise.all(
            fieldsToValidate.map((fieldName) =>
              form.validateField(fieldName, 'submit'),
            ),
          );

          return fieldsToValidate.every(
            (fieldName) =>
              (form.getFieldMeta(fieldName)?.errors?.length ?? 0) === 0,
          );
        }

        if (step === 'confirm') {
          await form.validateField('acceptCgv', 'submit');
          return (form.getFieldMeta('acceptCgv')?.errors?.length ?? 0) === 0;
        }

        return true;
      },
      [form, requireCustomerAddress],
    ),
  });

  const tulipQuoteCustomer = useMemo(
    () => {
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
    },
    [
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
    ],
  );

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
    !isTulipQuoteLoading &&
    !(
      tulipInsurance?.enabled &&
      tulipQuotePreview.mode === 'required' &&
      Boolean(tulipQuotePreview.error)
    );

  const createReservationMutation = useMutation({
    mutationFn: async (value: CheckoutFormValues) => {
      if (items.length === 0) {
        throw new CheckoutSubmitError('emptyCart');
      }
      if (!canSubmitCheckoutWithTulip) {
        throw new CheckoutSubmitError('lineNeedsUpdate');
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
        deliveryOption,
        deliveryAddress,
        tulipInsuranceMode,
      });

      const result = await createReservation(payload);

      if (result.error) {
        throw new CheckoutSubmitError(
          result.error,
          sanitizeTranslationParams(result.errorParams),
        );
      }

      return result;
    },
    onSuccess: (result) => {
      clearCart();

      if (reservationMode === 'payment' && result.paymentUrl) {
        window.location.href = result.paymentUrl;
        return;
      }

      toastManager.add({ title: t('requestSent'), type: 'success' });
      router.push(getUrl(`/confirmation/${result.reservationId}`));
    },
    onError: (error) => {
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

  const isBusinessCustomer = formValues.isBusinessCustomer;

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
                    showAddressFields={requireCustomerAddress}
                    isBusinessCustomer={isBusinessCustomer}
                    onBusinessCustomerUnchecked={() =>
                      form.setFieldValue('companyName', '')
                    }
                    onContinue={goToNextStep}
                  />
                )}

                {currentStep === 'delivery' &&
                  isDeliveryEnabled &&
                  deliverySettings && (
                    <CheckoutDeliveryStep
                      deliverySettings={deliverySettings}
                      deliveryOption={deliveryOption}
                      deliveryAddress={deliveryAddress}
                      deliveryDistance={deliveryDistance}
                      deliveryFee={deliveryFee}
                      deliveryError={deliveryError}
                      subtotal={subtotal}
                      currency={currency}
                      storeAddress={storeAddress}
                      isDeliveryForced={isDeliveryForced}
                      isDeliveryIncluded={isDeliveryIncluded}
                      onDeliveryOptionChange={handleDeliveryOptionChange}
                      onDeliveryAddressChange={handleDeliveryAddressChange}
                      onBack={goToPreviousStep}
                      onContinue={goToNextStep}
                    />
                  )}

                {currentStep === 'confirm' && (
                  <CheckoutConfirmStep
                    form={form}
                    cgv={cgv}
                    deliveryOption={deliveryOption}
                    reservationMode={reservationMode}
                    depositPercentage={depositPercentage}
                    subtotal={subtotalWithEstimatedInsurance}
                    totalWithDelivery={totalWithEstimatedInsurance}
                    currency={currency}
                    tulipInsurance={tulipInsurance}
                    tulipQuotePreview={tulipQuotePreview}
                    isTulipQuoteLoading={isTulipQuoteLoading}
                    canSubmitCheckout={canSubmitCheckoutWithTulip}
                    onBack={goToPreviousStep}
                    onEditContact={() => goToStep('contact')}
                  />
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
          deliveryOption={deliveryOption}
          deliveryDistance={deliveryDistance}
          deliveryFee={deliveryFee}
          tulipInsurance={tulipInsurance}
          tulipInsuranceOptIn={tulipInsuranceOptIn}
          isTulipQuoteLoading={isTulipQuoteLoading}
          tulipQuotePreview={tulipQuotePreview}
          lineResolutions={lineResolutions}
        />
      </div>
    </div>
  );
}
