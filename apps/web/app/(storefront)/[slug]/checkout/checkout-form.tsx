'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  CreditCard,
  Loader2,
  MapPin,
  Send,
  Truck,
  User,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Label,
  StepContent,
  toastManager,
} from '@louez/ui';
import { formatCurrency } from '@louez/utils';
import {
  calculateDeliveryFee,
  calculateHaversineDistance,
  validateDelivery,
} from '@/lib/utils/geo';

import { PhoneInput } from '@/components/ui/phone-input';
import { useAppForm } from '@/hooks/form/form';
import { getFieldError } from '@/hooks/form/form-context';
import { useStorefrontUrl } from '@/hooks/use-storefront-url';
import { orpcClient } from '@/lib/orpc/react';

import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

import { createReservation } from './actions';
import { buildReservationPayload } from './reservation-payload';
import { createCheckoutSchema } from './validation';
import {
  getCheckoutStepIds,
  sanitizeTranslationParams,
} from './utils';
import type {
  CheckoutFormProps,
  CheckoutFormValues,
  CheckoutStep,
  DeliveryAddress,
  DeliveryOption,
  StepId,
} from './types';
import { CheckoutDeliveryStep } from './components/checkout-delivery-step';
import { CheckoutEmptyCartState } from './components/checkout-empty-cart-state';
import { CheckoutOrderSummary } from './components/checkout-order-summary';
import { CheckoutWizardStepper } from './components/checkout-wizard-stepper';

const STEP_ICONS: Record<StepId, CheckoutStep['icon']> = {
  contact: User,
  delivery: Truck,
  address: MapPin,
  confirm: Check,
};

const DEFAULT_DELIVERY_ADDRESS: DeliveryAddress = {
  address: '',
  city: '',
  postalCode: '',
  country: 'FR',
  latitude: null,
  longitude: null,
};

type LineResolutionState =
  | { status: 'loading' }
  | {
      status: 'resolved';
      combinationKey: string;
      selectedAttributes: Record<string, string>;
    }
  | { status: 'invalid' };

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

  const [currentStep, setCurrentStep] = useState<StepId>('contact');
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>(
    'forward',
  );

  const hasStoreCoordinates =
    storeLatitude !== null &&
    storeLatitude !== undefined &&
    storeLongitude !== null &&
    storeLongitude !== undefined;
  const isDeliveryEnabled = Boolean(deliverySettings?.enabled && hasStoreCoordinates);
  const deliveryMode = deliverySettings?.mode ?? 'optional';
  const isDeliveryForced =
    deliveryMode === 'required' || deliveryMode === 'included';
  const isDeliveryIncluded = deliveryMode === 'included';

  const [deliveryOption, setDeliveryOption] = useState<DeliveryOption>(
    isDeliveryForced ? 'delivery' : 'pickup',
  );
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>(
    DEFAULT_DELIVERY_ADDRESS,
  );
  const [lineResolutions, setLineResolutions] = useState<Record<string, LineResolutionState>>({});
  const [deliveryDistance, setDeliveryDistance] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  useEffect(() => {
    if (isDeliveryForced) {
      setDeliveryOption('delivery');
    }
  }, [isDeliveryForced]);

  const stepIds = useMemo(
    () =>
      getCheckoutStepIds({
        isDeliveryEnabled,
        deliveryOption,
        requireCustomerAddress,
      }),
    [isDeliveryEnabled, deliveryOption, requireCustomerAddress],
  );

  const steps = useMemo<CheckoutStep[]>(
    () => stepIds.map((id) => ({ id, icon: STEP_ICONS[id] })),
    [stepIds],
  );

  useEffect(() => {
    if (!steps.some((step) => step.id === currentStep)) {
      setCurrentStep(steps[steps.length - 1].id);
    }
  }, [steps, currentStep]);

  const checkoutSchema = useMemo(
    () => createCheckoutSchema((key, params) => t(key, params)),
    [t],
  );

  const subtotal = getSubtotal();
  const totalDeposit = getTotalDeposit();
  const total = getTotal();
  const totalSavings = getTotalSavings();
  const originalSubtotal = getOriginalSubtotal();
  const totalWithDelivery =
    total + (deliveryOption === 'delivery' ? deliveryFee : 0);

  useEffect(() => {
    let cancelled = false;

    async function resolveCombinations() {
      if (items.length === 0) {
        setLineResolutions({});
        return;
      }

      const loadingState = Object.fromEntries(
        items.map((item) => [item.lineId, { status: 'loading' as const }]),
      );
      setLineResolutions(loadingState);

      const nextResolved: Record<string, LineResolutionState> = {};

      await Promise.all(
        items.map(async (item) => {
          try {
            const result =
              await orpcClient.storefront.availability.resolveCombination({
                productId: item.productId,
                quantity: item.quantity,
                startDate: item.startDate,
                endDate: item.endDate,
                selectedAttributes: item.selectedAttributes,
              });
            nextResolved[item.lineId] = {
              status: 'resolved',
              combinationKey: result.combinationKey,
              selectedAttributes: result.selectedAttributes,
            };
          } catch {
            nextResolved[item.lineId] = { status: 'invalid' };
          }
        }),
      );

      if (!cancelled) {
        setLineResolutions(nextResolved);
      }
    }

    resolveCombinations();

    return () => {
      cancelled = true;
    };
  }, [items]);

  const itemsWithResolved = useMemo(
    () =>
      items.map((item) => {
        const resolved = lineResolutions[item.lineId];
        if (!resolved || resolved.status !== 'resolved') {
          return item;
        }

        return {
          ...item,
          resolvedCombinationKey: resolved.combinationKey,
          resolvedAttributes: resolved.selectedAttributes,
        };
      }),
    [items, lineResolutions],
  );
  const hasInvalidLines = useMemo(
    () => items.some((item) => lineResolutions[item.lineId]?.status === 'invalid'),
    [items, lineResolutions],
  );
  const hasUnresolvedLines = useMemo(
    () =>
      items.some((item) => {
        const state = lineResolutions[item.lineId];
        return !state || state.status === 'loading';
      }),
    [items, lineResolutions],
  );
  const canSubmitCheckout = !hasInvalidLines && !hasUnresolvedLines;

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

  const defaultValues: CheckoutFormValues = {
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
    acceptCgv: false,
  };

  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onSubmit: checkoutSchema,
    },
    onSubmit: async ({ value }) => {
      await createReservationMutation.mutateAsync(value);
    },
  });
  const isBusinessCustomer = useStore(
    form.store,
    (state) => state.values.isBusinessCustomer,
  );

  const currentStepIndex = steps.findIndex((step) => step.id === currentStep);

  const handleDeliveryAddressChange = useCallback(
    (address: string, latitude: number | null, longitude: number | null) => {
      setDeliveryAddress((prev) => ({
        ...prev,
        address,
        latitude,
        longitude,
      }));
      setDeliveryError(null);

      if (
        latitude === null ||
        longitude === null ||
        storeLatitude === null ||
        storeLatitude === undefined ||
        storeLongitude === null ||
        storeLongitude === undefined ||
        !deliverySettings
      ) {
        setDeliveryDistance(null);
        setDeliveryFee(0);
        return;
      }

      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude,
      );
      setDeliveryDistance(distance);

      const validation = validateDelivery(distance, deliverySettings);
      if (!validation.valid) {
        setDeliveryError(
          t('deliveryTooFar', {
            maxKm: deliverySettings.maximumDistance ?? 0,
          }),
        );
        setDeliveryFee(0);
        return;
      }

      const fee = isDeliveryIncluded
        ? 0
        : calculateDeliveryFee(distance, deliverySettings, subtotal);
      setDeliveryFee(fee);
    },
    [
      deliverySettings,
      isDeliveryIncluded,
      storeLatitude,
      storeLongitude,
      subtotal,
      t,
    ],
  );

  const handleDeliveryOptionChange = useCallback((option: DeliveryOption) => {
    setDeliveryOption(option);

    if (option === 'pickup') {
      setDeliveryFee(0);
      setDeliveryDistance(null);
      setDeliveryError(null);
    }
  }, []);

  const validateCurrentStep = useCallback(async (): Promise<boolean> => {
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
  }, [currentStep, form]);

  const goToNextStep = useCallback(async () => {
    const isValid = await validateCurrentStep();
    if (!isValid) return;

    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= steps.length) return;

    setStepDirection('forward');
    setCurrentStep(steps[nextIndex].id);
  }, [validateCurrentStep, currentStepIndex, steps]);

  const goToPreviousStep = useCallback(() => {
    const previousIndex = currentStepIndex - 1;
    if (previousIndex < 0) return;

    setStepDirection('backward');
    setCurrentStep(steps[previousIndex].id);
  }, [currentStepIndex, steps]);

  const goToStep = useCallback(
    (stepId: StepId) => {
      const targetIndex = steps.findIndex((step) => step.id === stepId);
      if (targetIndex < 0 || targetIndex === currentStepIndex) return;

      setStepDirection(targetIndex > currentStepIndex ? 'forward' : 'backward');
      setCurrentStep(stepId);
    },
    [steps, currentStepIndex],
  );

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
                  <Card>
                    <CardContent className="space-y-4 pt-6">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold">
                          {t('steps.contact')}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                          {t('contactDescription')}
                        </p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <form.AppField name="firstName">
                          {(field) => (
                            <field.Input
                              label={t('firstName')}
                              placeholder={t('firstNamePlaceholder')}
                            />
                          )}
                        </form.AppField>
                        <form.AppField name="lastName">
                          {(field) => (
                            <field.Input
                              label={t('lastName')}
                              placeholder={t('lastNamePlaceholder')}
                            />
                          )}
                        </form.AppField>
                      </div>

                      <form.AppField name="email">
                        {(field) => (
                          <field.Input
                            label={t('email')}
                            type="email"
                            placeholder={t('emailPlaceholder')}
                          />
                        )}
                      </form.AppField>

                      <form.Field name="phone">
                        {(field) => (
                          <div className="space-y-2">
                            <Label>{t('phone')}</Label>
                            <PhoneInput
                              value={field.state.value}
                              onChange={(value) => field.handleChange(value)}
                              placeholder={t('phonePlaceholder')}
                            />
                            {field.state.meta.errors.length > 0 && (
                              <p className="text-destructive text-sm">
                                {getFieldError(field.state.meta.errors[0])}
                              </p>
                            )}
                          </div>
                        )}
                      </form.Field>

                      <form.Field name="isBusinessCustomer">
                        {(field) => (
                          <div className="flex flex-row items-center space-y-0 space-x-2">
                            <Checkbox
                              id={field.name}
                              checked={field.state.value}
                              onCheckedChange={(checked) => {
                                const isChecked = Boolean(checked);
                                field.handleChange(isChecked);

                                if (!isChecked) {
                                  form.setFieldValue('companyName', '');
                                }
                              }}
                            />
                            <Label
                              htmlFor={field.name}
                              className="cursor-pointer text-sm font-normal"
                            >
                              {t('isBusinessCustomer')}
                            </Label>
                          </div>
                        )}
                      </form.Field>

                      {isBusinessCustomer && (
                        <form.AppField name="companyName">
                          {(field) => (
                            <field.Input
                              label={`${t('companyName')} *`}
                              placeholder={t('companyNamePlaceholder')}
                            />
                          )}
                        </form.AppField>
                      )}

                      <div className="pt-4">
                        <Button
                          type="button"
                          onClick={goToNextStep}
                          className="w-full"
                          size="lg"
                        >
                          {t('continue')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
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
                  <Card>
                    <CardContent className="space-y-4 pt-6">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold">
                          {t('steps.address')}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                          {t('addressDescription')}
                        </p>
                      </div>

                      <form.AppField name="address">
                        {(field) => (
                          <field.Input
                            label={t('address')}
                            placeholder={t('addressPlaceholder')}
                          />
                        )}
                      </form.AppField>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <form.AppField name="postalCode">
                          {(field) => (
                            <field.Input
                              label={t('postalCode')}
                              placeholder={t('postalCodePlaceholder')}
                            />
                          )}
                        </form.AppField>
                        <form.AppField name="city">
                          {(field) => (
                            <field.Input
                              label={t('city')}
                              placeholder={t('cityPlaceholder')}
                            />
                          )}
                        </form.AppField>
                      </div>

                      <form.AppField name="notes">
                        {(field) => (
                          <field.Textarea
                            label={t('notes')}
                            placeholder={t('notesPlaceholder')}
                            rows={3}
                          />
                        )}
                      </form.AppField>

                      <div className="flex gap-3 pt-4">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={goToPreviousStep}
                          className="flex-1"
                        >
                          <ChevronLeft className="mr-2 h-4 w-4" />
                          {t('back')}
                        </Button>
                        <Button
                          type="button"
                          onClick={goToNextStep}
                          className="flex-1"
                        >
                          {t('continue')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {currentStep === 'confirm' && (
                  <Card>
                    <CardContent className="space-y-6 pt-6">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold">
                          {t('steps.confirm')}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                          {t('confirmDescription')}
                        </p>
                      </div>

                      <div className="bg-muted/50 space-y-2 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {t('customerInfo')}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => goToStep('contact')}
                          >
                            {t('modify')}
                          </Button>
                        </div>

                        {form.getFieldValue('isBusinessCustomer') &&
                          form.getFieldValue('companyName') && (
                            <p className="text-sm font-medium">
                              {form.getFieldValue('companyName')}
                            </p>
                          )}

                        <p className="text-sm">
                          {form.getFieldValue('firstName')}{' '}
                          {form.getFieldValue('lastName')}
                          {form.getFieldValue('isBusinessCustomer') && (
                            <span className="text-muted-foreground">
                              {' '}
                              ({t('contact')})
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {form.getFieldValue('email')}
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {form.getFieldValue('phone')}
                        </p>
                        {form.getFieldValue('address') && (
                          <p className="text-muted-foreground text-sm">
                            {form.getFieldValue('address')},{' '}
                            {form.getFieldValue('postalCode')}{' '}
                            {form.getFieldValue('city')}
                          </p>
                        )}
                        {deliveryOption === 'delivery' && (
                          <p className="text-muted-foreground text-sm">
                            {t('deliveryOption')}
                          </p>
                        )}
                      </div>

                      <div className="space-y-3">
                        {cgv && (
                          <div className="max-h-32 overflow-y-auto rounded-lg border p-3 text-xs">
                            <div
                              className="prose prose-xs dark:prose-invert prose-headings:text-sm prose-headings:font-semibold prose-headings:my-1 prose-p:my-1 prose-p:text-muted-foreground prose-a:text-primary max-w-none"
                              dangerouslySetInnerHTML={{ __html: cgv }}
                            />
                          </div>
                        )}

                        <form.Field name="acceptCgv">
                          {(field) => (
                            <div className="flex flex-row items-start space-y-0 space-x-3 rounded-lg border p-4">
                              <Checkbox
                                id={field.name}
                                checked={field.state.value}
                                onCheckedChange={(checked) =>
                                  field.handleChange(Boolean(checked))
                                }
                              />
                              <div className="space-y-1 leading-none">
                                <Label
                                  htmlFor={field.name}
                                  className="cursor-pointer"
                                >
                                  {t('acceptCgv')}
                                </Label>
                                {field.state.meta.errors.length > 0 && (
                                  <p className="text-destructive text-sm">
                                    {getFieldError(field.state.meta.errors[0])}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </form.Field>
                      </div>

                      <div className="flex gap-3 pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={goToPreviousStep}
                        >
                          <ChevronLeft className="mr-2 h-4 w-4" />
                          {t('back')}
                        </Button>

                        <form.Subscribe selector={(state) => state.isSubmitting}>
                          {(isSubmitting) => (
                            <Button
                              type="submit"
                              size="lg"
                              className="flex-1"
                              disabled={isSubmitting || !canSubmitCheckout}
                            >
                              {isSubmitting ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  {t('processing')}
                                </>
                              ) : reservationMode === 'payment' ? (
                                <>
                                  <CreditCard className="mr-2 h-4 w-4" />
                                  {depositPercentage < 100
                                    ? t('payDeposit', {
                                        amount: formatCurrency(
                                          Math.round(
                                            subtotal * depositPercentage,
                                          ) / 100,
                                          currency,
                                        ),
                                      })
                                    : `${t('pay')} ${formatCurrency(totalWithDelivery, currency)}`}
                                </>
                              ) : (
                                <>
                                  <Send className="mr-2 h-4 w-4" />
                                  {t('submitRequest')}
                                </>
                              )}
                            </Button>
                          )}
                        </form.Subscribe>
                      </div>
                    </CardContent>
                  </Card>
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
          lineResolutions={lineResolutions}
        />
      </div>
    </div>
  );
}
