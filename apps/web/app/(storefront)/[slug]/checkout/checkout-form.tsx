'use client';

import { useState } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ImageIcon,
  Loader2,
  MapPin,
  Send,
  ShoppingCart,
  Store,
  Truck,
  User,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { z } from 'zod';

import type { DeliverySettings, TaxSettings } from '@louez/types';
import { Label, toastManager } from '@louez/ui';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Separator,
} from '@louez/ui';
import {
  type ProductPricing,
  calculateRentalPrice,
  cn,
  formatCurrency,
} from '@louez/utils';

import { AddressInput } from '@/components/ui/address-input';
import { PhoneInput } from '@/components/ui/phone-input';

import { getDetailedDuration } from '@/lib/utils/duration';
import {
  calculateDeliveryFee,
  calculateHaversineDistance,
  isFreeDelivery,
  validateDelivery,
} from '@/lib/utils/geo';

import { useAppForm } from '@/hooks/form/form';
import { getFieldError } from '@/hooks/form/form-context';
import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

import { createReservation } from './actions';

interface CheckoutFormProps {
  storeSlug: string;
  storeId: string;
  pricingMode: 'day' | 'hour' | 'week';
  reservationMode: 'payment' | 'request';
  requireCustomerAddress: boolean;
  cgv: string | null;
  taxSettings?: TaxSettings;
  depositPercentage?: number;
  deliverySettings?: DeliverySettings;
  storeAddress?: string | null;
  storeLatitude?: number | null;
  storeLongitude?: number | null;
}

/**
 * Calculate duration for pricing
 * Uses Math.ceil (round up) - industry standard: any partial period = full period billed
 */
function calculateDuration(
  startDate: string,
  endDate: string,
  pricingMode: 'day' | 'hour' | 'week',
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();

  switch (pricingMode) {
    case 'hour':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    case 'week':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)));
    default:
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }
}

type StepId = 'contact' | 'delivery' | 'address' | 'confirm';

interface Step {
  id: StepId;
  icon: React.ComponentType<{ className?: string }>;
}

interface DeliveryAddress {
  address: string;
  city: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
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
  const tProduct = useTranslations('storefront.product');
  const tCart = useTranslations('storefront.cart');
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delivery state
  const isDeliveryEnabled =
    deliverySettings?.enabled && storeLatitude && storeLongitude;
  const deliveryMode = deliverySettings?.mode || 'optional';
  // If mode is 'required' or 'included', force delivery option
  const isDeliveryForced =
    deliveryMode === 'required' || deliveryMode === 'included';
  // If mode is 'included', delivery is always free
  const isDeliveryIncluded = deliveryMode === 'included';
  const [deliveryOption, setDeliveryOption] = useState<'pickup' | 'delivery'>(
    isDeliveryForced ? 'delivery' : 'pickup',
  );
  const [deliveryAddress, setDeliveryAddress] = useState<DeliveryAddress>({
    address: '',
    city: '',
    postalCode: '',
    country: 'FR',
    latitude: null,
    longitude: null,
  });
  const [deliveryDistance, setDeliveryDistance] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  // Calculate delivery when address changes
  const handleDeliveryAddressChange = (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => {
    setDeliveryAddress((prev) => ({ ...prev, address, latitude, longitude }));
    setDeliveryError(null);

    if (
      latitude &&
      longitude &&
      storeLatitude &&
      storeLongitude &&
      deliverySettings
    ) {
      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude,
      );
      setDeliveryDistance(distance);

      // Validate distance
      const validation = validateDelivery(distance, deliverySettings);
      if (!validation.valid) {
        setDeliveryError(
          t('deliveryTooFar', { maxKm: deliverySettings.maximumDistance ?? 0 }),
        );
        setDeliveryFee(0);
        return;
      }

      // Calculate fee (always 0 if delivery is included)
      const fee = isDeliveryIncluded
        ? 0
        : calculateDeliveryFee(distance, deliverySettings, getSubtotal());
      setDeliveryFee(fee);
    } else {
      setDeliveryDistance(null);
      setDeliveryFee(0);
    }
  };

  // Build steps array based on settings
  const steps: Step[] = (() => {
    const result: Step[] = [{ id: 'contact', icon: User }];

    // Add delivery step if enabled
    if (isDeliveryEnabled) {
      result.push({ id: 'delivery', icon: Truck });
    }

    // Add address step if:
    // 1. Delivery is selected (need delivery address details), OR
    // 2. Store requires customer address
    if (deliveryOption === 'delivery' || requireCustomerAddress) {
      result.push({ id: 'address', icon: MapPin });
    }

    result.push({ id: 'confirm', icon: Check });
    return result;
  })();

  const checkoutSchema = z
    .object({
      email: z.string().email(t('errors.invalidEmail')),
      firstName: z.string().min(1, t('errors.firstNameRequired')),
      lastName: z.string().min(1, t('errors.lastNameRequired')),
      phone: z
        .string()
        .min(1, t('errors.phoneRequired'))
        .regex(/^\+[1-9]\d{6,14}$/, t('errors.invalidPhone')),
      isBusinessCustomer: z.boolean(),
      companyName: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      notes: z.string().optional(),
      acceptCgv: z.boolean(),
    })
    .superRefine((data, ctx) => {
      // If business customer, company name is required
      if (
        data.isBusinessCustomer &&
        (!data.companyName || data.companyName.trim().length === 0)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('errors.companyNameRequired'),
          path: ['companyName'],
        });
      }
      // CGV must be accepted
      if (!data.acceptCgv) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('errors.acceptCgv'),
          path: ['acceptCgv'],
        });
      }
    });

  const form = useAppForm({
    defaultValues: {
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
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validators: { onSubmit: checkoutSchema as any },
    onSubmit: async ({ value }) => {
      if (items.length === 0) {
        toastManager.add({ title: t('emptyCart'), type: 'error' });
        return;
      }

      setIsSubmitting(true);

      try {
        // Calculate total with delivery fee
        const totalWithDelivery =
          getTotal() + (deliveryOption === 'delivery' ? deliveryFee : 0);

        const result = await createReservation({
          storeId,
          customer: {
            email: value.email,
            firstName: value.firstName,
            lastName: value.lastName,
            phone: value.phone,
            customerType: value.isBusinessCustomer ? 'business' : 'individual',
            companyName: value.isBusinessCustomer
              ? value.companyName
              : undefined,
            address: value.address,
            city: value.city,
            postalCode: value.postalCode,
          },
          items: items.map((item) => {
            // Calculate effective unit price with tiered pricing
            const itemPricingMode = item.productPricingMode || pricingMode;
            const duration = calculateDuration(
              item.startDate,
              item.endDate,
              itemPricingMode,
            );

            let effectiveUnitPrice = item.price;
            if (item.pricingTiers && item.pricingTiers.length > 0) {
              const pricing: ProductPricing = {
                basePrice: item.price,
                deposit: item.deposit,
                pricingMode: itemPricingMode,
                tiers: item.pricingTiers.map((t, i) => ({
                  ...t,
                  displayOrder: i,
                })),
              };
              const result = calculateRentalPrice(
                pricing,
                duration,
                item.quantity,
              );
              effectiveUnitPrice = result.effectivePricePerUnit;
            }

            return {
              productId: item.productId,
              quantity: item.quantity,
              startDate: item.startDate,
              endDate: item.endDate,
              unitPrice: effectiveUnitPrice,
              depositPerUnit: item.deposit,
              productSnapshot: {
                name: item.productName,
                description: null,
                images: item.productImage ? [item.productImage] : [],
              },
            };
          }),
          customerNotes: value.notes,
          subtotalAmount: getSubtotal(),
          depositAmount: getTotalDeposit(),
          totalAmount: totalWithDelivery,
          locale,
          // Delivery data
          delivery:
            deliveryOption === 'delivery' &&
            deliveryAddress.latitude &&
            deliveryAddress.longitude
              ? {
                  option: 'delivery',
                  address: deliveryAddress.address,
                  city: deliveryAddress.city,
                  postalCode: deliveryAddress.postalCode,
                  country: deliveryAddress.country,
                  latitude: deliveryAddress.latitude,
                  longitude: deliveryAddress.longitude,
                }
              : { option: 'pickup' },
        });

        if (result.error) {
          // Translate the error message if it's an i18n key
          let errorMessage = result.error;
          if (result.error.startsWith('errors.')) {
            const errorKey = result.error.replace('errors.', '');
            // Filter out undefined/null values from errorParams for translation
            const params: Record<string, string | number> = {};
            if (result.errorParams) {
              for (const [key, value] of Object.entries(result.errorParams)) {
                if (
                  value !== undefined &&
                  value !== null &&
                  (typeof value === 'string' || typeof value === 'number')
                ) {
                  params[key] = value;
                }
              }
            }
            errorMessage = tErrors(errorKey, params);
          }
          toastManager.add({ title: errorMessage, type: 'error' });
          return;
        }

        clearCart();

        if (reservationMode === 'payment' && result.paymentUrl) {
          window.location.href = result.paymentUrl;
        } else {
          toastManager.add({ title: t('requestSent'), type: 'success' });
          router.push(getUrl(`/confirmation/${result.reservationId}`));
        }
      } catch {
        toastManager.add({ title: tErrors('generic'), type: 'error' });
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const isBusinessCustomer = useStore(
    form.store,
    (s) => s.values.isBusinessCustomer,
  );

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const validateCurrentStep = async (): Promise<boolean> => {
    if (currentStep === 'contact') {
      const fieldsToValidate: string[] = [
        'firstName',
        'lastName',
        'email',
        'phone',
      ];
      if (form.getFieldValue('isBusinessCustomer')) {
        fieldsToValidate.push('companyName');
      }
      // Validate each field
      const results = await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fieldsToValidate.map((fieldName) =>
          form.validateField(fieldName as any, 'submit'),
        ),
      );
      // Check if any field has errors
      return results.every((r) => r.length === 0);
    }
    if (currentStep === 'address') {
      return true; // All optional
    }
    if (currentStep === 'confirm') {
      const result = await form.validateField('acceptCgv', 'submit');
      return result.length === 0;
    }
    return true;
  };

  const goToNextStep = async () => {
    const isValid = await validateCurrentStep();
    if (!isValid) return;

    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    }
  };

  const goToPreviousStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id);
    }
  };

  // Duration label
  const durationLabel = (() => {
    if (!globalStartDate || !globalEndDate) return '';
    const { days, hours } = getDetailedDuration(globalStartDate, globalEndDate);
    if (pricingMode === 'hour') return `${days * 24 + hours}h`;
    if (days === 0) return `${hours}h`;
    if (hours === 0) return `${days}j`;
    return `${days}j ${hours}h`;
  })();

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ShoppingCart className="text-muted-foreground mb-4 h-16 w-16" />
        <h2 className="mb-2 text-xl font-semibold">{t('emptyCart')}</h2>
        <p className="text-muted-foreground mb-6">
          {t('emptyCartDescription')}
        </p>
        <Button render={<Link href={getUrl('/catalog')} />}>
          {tCart('viewCatalog')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Stepper */}
      <div className="mb-8">
        <div className="flex items-center justify-center">
          {steps.map((step, index) => {
            const isActive = step.id === currentStep;
            const isCompleted = index < currentStepIndex;
            const Icon = step.icon;

            return (
              <div key={step.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (isCompleted) setCurrentStep(step.id);
                  }}
                  disabled={!isCompleted && !isActive}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-4 py-2 transition-all',
                    isActive && 'bg-primary text-primary-foreground',
                    isCompleted &&
                      'bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer',
                    !isActive && !isCompleted && 'text-muted-foreground',
                  )}
                >
                  <div
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium',
                      isActive && 'bg-primary-foreground/20',
                      isCompleted && 'bg-primary text-primary-foreground',
                      !isActive && !isCompleted && 'bg-muted',
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <span className="hidden font-medium sm:inline">
                    {t(`steps.${step.id}`)}
                  </span>
                </button>
                {index < steps.length - 1 && (
                  <ChevronRight className="text-muted-foreground mx-2 h-5 w-5" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Form */}
        <div className="lg:col-span-3">
          <form.AppForm>
            <form.Form>
              {/* Step 1: Contact */}
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

                    {/* Business customer checkbox - simple inline style */}
                    <form.Field name="isBusinessCustomer">
                      {(field) => (
                        <div className="flex flex-row items-center space-y-0 space-x-2">
                          <Checkbox
                            id={field.name}
                            checked={field.state.value}
                            onCheckedChange={(checked) => {
                              field.handleChange(checked as boolean);
                              if (!checked) {
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

                    {/* Company name - only shown for business customers */}
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

              {/* Step: Delivery (when enabled) */}
              {currentStep === 'delivery' &&
                isDeliveryEnabled &&
                deliverySettings && (
                  <Card>
                    <CardContent className="space-y-6 pt-6">
                      <div className="mb-4">
                        <h2 className="text-lg font-semibold">
                          {t('steps.delivery')}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                          {isDeliveryForced
                            ? isDeliveryIncluded
                              ? t('deliveryIncludedDescription')
                              : t('deliveryRequiredDescription')
                            : t('deliveryDescription')}
                        </p>
                      </div>

                      {/* Pickup vs Delivery Selection - Only in optional mode */}
                      {!isDeliveryForced && (
                        <RadioGroup
                          value={deliveryOption}
                          onValueChange={(value) => {
                            setDeliveryOption(value as 'pickup' | 'delivery');
                            if (value === 'pickup') {
                              setDeliveryFee(0);
                              setDeliveryDistance(null);
                              setDeliveryError(null);
                            }
                          }}
                          className="grid gap-3"
                        >
                          {/* Pickup Option */}
                          <label
                            className={cn(
                              'flex cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors',
                              deliveryOption === 'pickup'
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50',
                            )}
                          >
                            <RadioGroupItem
                              value="pickup"
                              id="pickup"
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Store className="h-4 w-4" />
                                <span className="font-medium">
                                  {t('pickupOption')}
                                </span>
                                <Badge variant="secondary">{t('free')}</Badge>
                              </div>
                              {storeAddress && (
                                <p className="text-muted-foreground mt-1 text-sm">
                                  {storeAddress}
                                </p>
                              )}
                            </div>
                          </label>

                          {/* Delivery Option */}
                          <label
                            className={cn(
                              'flex cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors',
                              deliveryOption === 'delivery'
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50',
                            )}
                          >
                            <RadioGroupItem
                              value="delivery"
                              id="delivery"
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Truck className="h-4 w-4" />
                                <span className="font-medium">
                                  {t('deliveryOption')}
                                </span>
                              </div>
                              <p className="text-muted-foreground mt-1 text-sm">
                                {t('deliveryOptionDescription', {
                                  pricePerKm: formatCurrency(
                                    deliverySettings.pricePerKm,
                                    currency,
                                  ),
                                })}
                              </p>
                              {deliverySettings.freeDeliveryThreshold &&
                                isFreeDelivery(
                                  getSubtotal(),
                                  deliverySettings,
                                ) && (
                                  <p className="mt-1 text-sm text-green-600">
                                    {t('freeDeliveryApplied')}
                                  </p>
                                )}
                              {deliverySettings.freeDeliveryThreshold &&
                                !isFreeDelivery(
                                  getSubtotal(),
                                  deliverySettings,
                                ) && (
                                  <p className="text-muted-foreground mt-1 text-sm">
                                    {t('freeDeliveryAbove', {
                                      amount: formatCurrency(
                                        deliverySettings.freeDeliveryThreshold,
                                        currency,
                                      ),
                                    })}
                                  </p>
                                )}
                            </div>
                          </label>
                        </RadioGroup>
                      )}

                      {/* Forced delivery info banner (required or included mode) */}
                      {isDeliveryForced && (
                        <div
                          className={cn(
                            'flex items-start gap-3 rounded-lg p-4',
                            isDeliveryIncluded
                              ? 'bg-green-50 dark:bg-green-950/30'
                              : 'bg-blue-50 dark:bg-blue-950/30',
                          )}
                        >
                          <Truck
                            className={cn(
                              'mt-0.5 h-5 w-5 shrink-0',
                              isDeliveryIncluded
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-blue-600 dark:text-blue-400',
                            )}
                          />
                          <div>
                            <p
                              className={cn(
                                'font-medium',
                                isDeliveryIncluded
                                  ? 'text-green-700 dark:text-green-300'
                                  : 'text-blue-700 dark:text-blue-300',
                              )}
                            >
                              {isDeliveryIncluded
                                ? t('deliveryIncludedBanner')
                                : t('deliveryRequiredBanner')}
                            </p>
                            <p
                              className={cn(
                                'mt-0.5 text-sm',
                                isDeliveryIncluded
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-blue-600 dark:text-blue-400',
                              )}
                            >
                              {isDeliveryIncluded
                                ? t('deliveryIncludedNote')
                                : t('deliveryRequiredNote')}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Delivery Address Input (shown when delivery selected or forced) */}
                      {(deliveryOption === 'delivery' || isDeliveryForced) && (
                        <div
                          className={cn(
                            'space-y-4',
                            !isDeliveryForced && 'border-t pt-6',
                          )}
                        >
                          <div>
                            <label className="text-sm font-medium">
                              {t('deliveryAddress')}
                            </label>
                            <div className="mt-2">
                              <AddressInput
                                value={deliveryAddress.address}
                                latitude={deliveryAddress.latitude}
                                longitude={deliveryAddress.longitude}
                                onChange={(address, lat, lng) =>
                                  handleDeliveryAddressChange(address, lat, lng)
                                }
                                placeholder={t('deliveryAddressPlaceholder')}
                              />
                            </div>
                          </div>

                          {/* Delivery Cost Preview */}
                          {deliveryDistance !== null && !deliveryError && (
                            <div className="bg-muted/50 rounded-lg p-4">
                              <div className="flex justify-between text-sm">
                                <span>{t('deliveryDistance')}</span>
                                <span>{deliveryDistance.toFixed(1)} km</span>
                              </div>
                              {!isDeliveryIncluded && (
                                <div className="mt-2 flex justify-between font-medium">
                                  <span>{t('deliveryFee')}</span>
                                  <span
                                    className={
                                      deliveryFee === 0 ? 'text-green-600' : ''
                                    }
                                  >
                                    {deliveryFee === 0
                                      ? t('free')
                                      : formatCurrency(deliveryFee, currency)}
                                  </span>
                                </div>
                              )}
                              {isDeliveryIncluded && (
                                <div className="mt-2 flex justify-between font-medium text-green-600">
                                  <span>{t('deliveryFee')}</span>
                                  <span>{t('included')}</span>
                                </div>
                              )}
                              {deliveryFee === 0 &&
                                !isDeliveryIncluded &&
                                deliverySettings.freeDeliveryThreshold && (
                                  <p className="mt-1 text-xs text-green-600">
                                    {t('freeDeliveryApplied')}
                                  </p>
                                )}
                              {deliverySettings.roundTrip &&
                                !isDeliveryIncluded && (
                                  <p className="text-muted-foreground mt-2 text-xs">
                                    {t('roundTripNote', {
                                      distance: deliveryDistance.toFixed(1),
                                      total: (deliveryDistance * 2).toFixed(1),
                                    })}
                                  </p>
                                )}
                            </div>
                          )}

                          {/* Maximum Distance Error */}
                          {deliveryError && (
                            <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">
                              {deliveryError}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Navigation */}
                      <div className="flex gap-3 pt-4">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={goToPreviousStep}
                        >
                          <ChevronLeft className="mr-2 h-4 w-4" />
                          {t('back')}
                        </Button>
                        <Button
                          type="button"
                          onClick={goToNextStep}
                          className="flex-1"
                          disabled={
                            deliveryOption === 'delivery' &&
                            (!deliveryAddress.latitude || !!deliveryError)
                          }
                        >
                          {t('continue')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

              {/* Step: Address (Optional or required for delivery) */}
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

              {/* Step 3: Confirmation */}
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

                    {/* Customer summary */}
                    <div className="bg-muted/50 space-y-2 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {t('customerInfo')}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setCurrentStep('contact')}
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
                    </div>

                    {/* CGV */}
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
                                field.handleChange(checked as boolean)
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
                      <Button
                        type="submit"
                        size="lg"
                        className="flex-1"
                        disabled={isSubmitting}
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
                                      getSubtotal() * depositPercentage,
                                    ) / 100,
                                    currency,
                                  ),
                                })
                              : `${t('pay')} ${formatCurrency(getTotal() + (deliveryOption === 'delivery' ? deliveryFee : 0), currency)}`}
                          </>
                        ) : (
                          <>
                            <Send className="mr-2 h-4 w-4" />
                            {t('submitRequest')}
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </form.Form>
          </form.AppForm>
        </div>

        {/* Order Summary - Always visible */}
        <div className="lg:col-span-2">
          <Card className="sticky top-4">
            <CardContent className="space-y-4 pt-6">
              <h3 className="font-semibold">{t('summary')}</h3>

              {/* Dates */}
              {globalStartDate && globalEndDate && (
                <div className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {format(new Date(globalStartDate), 'dd MMM', {
                      locale: fr,
                    })}{' '}
                    →{' '}
                    {format(new Date(globalEndDate), 'dd MMM', { locale: fr })}
                  </span>
                  <Badge variant="secondary">{durationLabel}</Badge>
                </div>
              )}

              {/* Items */}
              <div className="space-y-3">
                {items.map((item) => {
                  const duration = calculateDuration(
                    item.startDate,
                    item.endDate,
                    item.pricingMode,
                  );
                  const itemPricingMode =
                    item.productPricingMode || pricingMode;

                  // Calculate with tiered pricing if available
                  let itemTotal: number;
                  let itemSavings = 0;
                  let discountPercent: number | null = null;

                  if (item.pricingTiers && item.pricingTiers.length > 0) {
                    const pricing: ProductPricing = {
                      basePrice: item.price,
                      deposit: item.deposit,
                      pricingMode: itemPricingMode,
                      tiers: item.pricingTiers.map((t, i) => ({
                        ...t,
                        displayOrder: i,
                      })),
                    };
                    const result = calculateRentalPrice(
                      pricing,
                      duration,
                      item.quantity,
                    );
                    itemTotal = result.subtotal;
                    itemSavings = result.savings;
                    discountPercent = result.discountPercent;
                  } else {
                    itemTotal = item.price * item.quantity * duration;
                  }

                  return (
                    <div key={item.productId} className="flex gap-3">
                      <div className="bg-muted relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg">
                        {item.productImage ? (
                          <Image
                            src={item.productImage}
                            alt={item.productName}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageIcon className="text-muted-foreground h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {item.productName}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {item.quantity} ×{' '}
                          {formatCurrency(item.price, currency)} × {duration}
                        </p>
                        {discountPercent && (
                          <Badge
                            variant="secondary"
                            className="mt-1 bg-green-100 text-xs text-green-700 dark:bg-green-900/50 dark:text-green-300"
                          >
                            -{discountPercent}%
                          </Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {formatCurrency(itemTotal, currency)}
                        </p>
                        {itemSavings > 0 && (
                          <p className="text-xs text-green-600">
                            -{formatCurrency(itemSavings, currency)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <Separator />

              {/* Totals */}
              <div className="space-y-2">
                {/* Show original price and discount if applicable */}
                {getTotalSavings() > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {tCart('subtotal')}
                      </span>
                      <span className="text-muted-foreground line-through">
                        {formatCurrency(getOriginalSubtotal(), currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-green-600">
                      <span>{t('pricing.discount')}</span>
                      <span>
                        -{formatCurrency(getTotalSavings(), currency)}
                      </span>
                    </div>
                  </>
                )}

                {/* Delivery fee (if applicable) */}
                {deliveryOption === 'delivery' && deliveryDistance !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5" />
                      {t('deliveryFee')}
                    </span>
                    <span
                      className={
                        deliveryFee === 0 ? 'font-medium text-green-600' : ''
                      }
                    >
                      {deliveryFee === 0
                        ? t('free')
                        : formatCurrency(deliveryFee, currency)}
                    </span>
                  </div>
                )}

                <Separator />
                <div className="flex justify-between text-lg font-semibold">
                  <span>{tCart('total')}</span>
                  <span className="text-primary">
                    {formatCurrency(
                      getTotal() +
                        (deliveryOption === 'delivery' ? deliveryFee : 0),
                      currency,
                    )}
                  </span>
                </div>
                {/* Partial payment info - only in payment mode with deposit < 100% */}
                {reservationMode === 'payment' && depositPercentage < 100 && (
                  <div className="space-y-1.5 pt-2">
                    <div className="flex justify-between text-base font-semibold">
                      <span>{t('toPayNow')}</span>
                      <span className="text-primary">
                        {formatCurrency(
                          Math.round(getSubtotal() * depositPercentage) / 100,
                          currency,
                        )}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t('remainingAtPickup', {
                        amount: formatCurrency(
                          Math.round(
                            getSubtotal() * (100 - depositPercentage),
                          ) / 100,
                          currency,
                        ),
                      })}
                    </p>
                  </div>
                )}
                {taxSettings?.enabled && (
                  <p className="text-muted-foreground pt-2 text-center text-xs">
                    {taxSettings.displayMode === 'inclusive'
                      ? tCart('pricesIncludeTax')
                      : tCart('pricesExcludeTax')}
                  </p>
                )}
              </div>

              {/* Savings banner */}
              {getTotalSavings() > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
                  {t('pricing.savingsBanner', {
                    amount: formatCurrency(getTotalSavings(), currency),
                  })}
                </div>
              )}

              {/* Deposit info - explains authorization hold */}
              {getTotalDeposit() > 0 && reservationMode === 'payment' && (
                <div className="mt-2 space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('depositLabel')}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(getTotalDeposit(), currency)}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('depositAuthorizationInfo')}
                  </p>
                </div>
              )}
              {getTotalDeposit() > 0 && reservationMode !== 'payment' && (
                <div className="text-muted-foreground mt-2 border-t pt-3 text-xs">
                  <p>
                    {t('depositInfo', {
                      amount: formatCurrency(getTotalDeposit(), currency),
                    })}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
