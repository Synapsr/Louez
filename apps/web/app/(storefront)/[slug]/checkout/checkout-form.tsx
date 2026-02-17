'use client';

import { useCallback, useMemo } from 'react';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { Check, MapPin, Truck, User } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { StepContent, toastManager } from '@louez/ui';

import { useAppForm } from '@/hooks/form/form';
import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

import { createReservation } from './actions';
import { buildReservationPayload } from './reservation-payload';
import type {
  CheckoutFormProps,
  CheckoutFormValues,
  CheckoutStep,
  StepId,
} from './types';
import { createCheckoutSchema } from './validation';
import { sanitizeTranslationParams } from './utils';
import { CheckoutAddressStep } from './components/checkout-address-step';
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
    () => createCheckoutSchema((key, params) => t(key, params)),
    [t],
  );

  const createReservationMutation = useMutation({
    mutationFn: async (value: CheckoutFormValues) => {
      if (items.length === 0) {
        throw new CheckoutSubmitError('emptyCart');
      }
      if (!canSubmitCheckout) {
        throw new CheckoutSubmitError('lineNeedsUpdate');
      }

      const payload = buildReservationPayload({
        storeId,
        pricingMode,
        locale,
        values: value,
        items: itemsWithResolved,
        subtotalAmount: subtotal,
        depositAmount: totalDeposit,
        totalAmount: totalWithDelivery,
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

  const isBusinessCustomer = useStore(
    form.store,
    (state) => state.values.isBusinessCustomer,
  );

  const validateCurrentStep = useCallback(
    async (currentStep: StepId): Promise<boolean> => {
      if (currentStep === 'contact') {
        const fieldsToValidate: Array<keyof CheckoutFormValues> = [
          'firstName',
          'lastName',
          'email',
          'phone',
        ];

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

      if (currentStep === 'confirm') {
        await form.validateField('acceptCgv', 'submit');
        return (form.getFieldMeta('acceptCgv')?.errors?.length ?? 0) === 0;
      }

      return true;
    },
    [form],
  );

  const tulipInsuranceOptIn = useStore(
    form.store,
    (state) => state.values.tulipInsuranceOptIn,
  );

  const {
    currentStep,
    stepDirection,
    steps,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  } = useCheckoutStepFlow({
    isDeliveryEnabled,
    deliveryOption,
    requireCustomerAddress,
    stepIcons: STEP_ICONS,
    validateCurrentStep,
  });

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

                {currentStep === 'address' && (
                  <CheckoutAddressStep
                    form={form}
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
                    subtotal={subtotal}
                    totalWithDelivery={totalWithDelivery}
                    currency={currency}
                    tulipInsurance={tulipInsurance}
                    canSubmitCheckout={canSubmitCheckout}
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
              lineResolutions={lineResolutions}
            />
          </div>
    </div>
  );
}
