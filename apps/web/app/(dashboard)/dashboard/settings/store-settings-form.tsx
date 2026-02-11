'use client';

import { useState } from 'react';
import { useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import {
  ArrowRight,
  CreditCard,
  ExternalLink,
  Info,
  Pencil,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import type { StoreSettings } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Switch } from '@louez/ui';
import { Slider } from '@louez/ui';
import { Checkbox } from '@louez/ui';
import { Label } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogPanel,
} from '@louez/ui';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui';

import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar';
import { RootError } from '@/components/form/root-error';
import { AddressInput } from '@/components/ui/address-input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';

import {
  getCountriesSortedByName,
  getCountryFlag,
  getCountryName,
  getTimezoneForCountry,
} from '@/lib/utils/countries';
import {
  type CurrencyCode,
  SUPPORTED_CURRENCIES,
  getCurrencyByCode,
  getDefaultCurrencyForCountry,
} from '@/lib/utils/currency';
import {
  getMaxRentalMinutes,
  getMinRentalMinutes,
} from '@/lib/utils/rental-duration';

import { useAppForm } from '@/hooks/form/form';
import { getFieldError } from '@/hooks/form/form-context';

import { env } from '@/env';

import { updateStoreSettings } from './actions';
import { SlugChangeModal } from './slug-change-modal';

const createStoreSettingsSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z.object({
    name: z
      .string()
      .min(2, t('minLength', { min: 2 }))
      .max(255),
    description: z.string(),
    email: z.string().email(t('email')).or(z.literal('')),
    phone: z.string(),
    address: z.string(),
    country: z.string().length(2),
    currency: z.string().min(3).max(3),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),

    // Billing address
    billingAddressSameAsStore: z.boolean(),
    billingAddress: z.string(),
    billingCity: z.string(),
    billingPostalCode: z.string(),
    billingCountry: z.string(),

    // Settings
    reservationMode: z.enum(['payment', 'request']),
    pendingBlocksAvailability: z.boolean(),
    onlinePaymentDepositPercentage: z.number().int().min(10).max(100),
    minRentalMinutes: z.number().int().min(0),
    maxRentalMinutes: z.number().int().min(1).nullable(),
    advanceNoticeMinutes: z.number().min(0),
    requireCustomerAddress: z.boolean(),
  });

type StoreSettingsInput = z.infer<ReturnType<typeof createStoreSettingsSchema>>;

interface Store {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  latitude: string | null;
  longitude: string | null;
  settings: StoreSettings | null;
}

interface StoreSettingsFormProps {
  store: Store;
  stripeChargesEnabled: boolean;
}

export function StoreSettingsForm({
  store,
  stripeChargesEnabled,
}: StoreSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSlugModalOpen, setIsSlugModalOpen] = useState(false);
  const [isStripeRequiredDialogOpen, setIsStripeRequiredDialogOpen] =
    useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const minRentalMinutesInit = getMinRentalMinutes(
    store.settings as StoreSettings | null,
  );
  const advanceNoticeMinutesInit =
    (store.settings as StoreSettings | null)?.advanceNoticeMinutes ?? 0;
  const [minDurationUnit, setMinDurationUnit] = useState<'hours' | 'days'>(
    minRentalMinutesInit > 0 && minRentalMinutesInit % 1440 === 0
      ? 'days'
      : 'hours',
  );
  const [advanceNoticeUnit, setAdvanceNoticeUnit] = useState<'hours' | 'days'>(
    advanceNoticeMinutesInit > 0 && advanceNoticeMinutesInit % 1440 === 0
      ? 'days'
      : 'hours',
  );
  const t = useTranslations('dashboard.settings');

  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');

  const storeSettingsSchema = createStoreSettingsSchema(tValidation);

  const settings: StoreSettings = {
    reservationMode: store.settings?.reservationMode ?? 'payment',
    pendingBlocksAvailability: store.settings?.pendingBlocksAvailability ?? true,
    onlinePaymentDepositPercentage:
      store.settings?.onlinePaymentDepositPercentage ?? 100,
    minRentalMinutes: store.settings?.minRentalMinutes ?? 60,
    maxRentalMinutes: store.settings?.maxRentalMinutes ?? null,
    advanceNoticeMinutes: store.settings?.advanceNoticeMinutes ?? 1440,
    requireCustomerAddress: store.settings?.requireCustomerAddress ?? false,
    businessHours: store.settings?.businessHours,
    country: store.settings?.country,
    timezone: store.settings?.timezone,
    currency: store.settings?.currency,
    tax: store.settings?.tax,
    billingAddress: store.settings?.billingAddress,
    delivery: store.settings?.delivery,
    inspection: store.settings?.inspection,
  };

  const defaultCountry = settings.country || 'FR';
  const defaultCurrency =
    settings.currency || getDefaultCurrencyForCountry(defaultCountry);

  const billingAddress = settings.billingAddress || { useSameAsStore: true };

  const form = useAppForm({
    defaultValues: {
      name: store.name,
      description: store.description || '',
      email: store.email || '',
      phone: store.phone || '',
      address: store.address || '',
      country: defaultCountry,
      currency: defaultCurrency,
      latitude: store.latitude ? parseFloat(store.latitude) : null,
      longitude: store.longitude ? parseFloat(store.longitude) : null,
      billingAddressSameAsStore: billingAddress.useSameAsStore,
      billingAddress: billingAddress.address || '',
      billingCity: billingAddress.city || '',
      billingPostalCode: billingAddress.postalCode || '',
      billingCountry: billingAddress.country || defaultCountry,
      reservationMode: settings.reservationMode,
      pendingBlocksAvailability: settings.pendingBlocksAvailability ?? true,
      onlinePaymentDepositPercentage:
        settings.onlinePaymentDepositPercentage ?? 100,
      minRentalMinutes: getMinRentalMinutes(settings as StoreSettings),
      maxRentalMinutes: getMaxRentalMinutes(settings as StoreSettings),
      advanceNoticeMinutes: settings.advanceNoticeMinutes,
      requireCustomerAddress: settings.requireCustomerAddress ?? false,
    },
    validators: { onSubmit: storeSettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      startTransition(async () => {
        const result = await updateStoreSettings(value);
        if (result.error) {
          setRootError(result.error);
          return;
        }
        toastManager.add({ title: t('settingsSaved'), type: 'success' });
        form.reset();
        router.refresh();
      });
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);
  const billingAddressSameAsStore = useStore(
    form.store,
    (s) => s.values.billingAddressSameAsStore,
  );
  const reservationMode = useStore(form.store, (s) => s.values.reservationMode);
  const latitude = useStore(form.store, (s) => s.values.latitude);
  const longitude = useStore(form.store, (s) => s.values.longitude);
  const billingAddressValue = useStore(
    form.store,
    (s) => s.values.billingAddress,
  );
  const billingCity = useStore(form.store, (s) => s.values.billingCity);
  const billingPostalCode = useStore(
    form.store,
    (s) => s.values.billingPostalCode,
  );
  const billingCountry = useStore(form.store, (s) => s.values.billingCountry);

  // Auto-update currency when country changes (only if user hasn't manually changed it)
  const handleCountryChange = (
    newCountry: string,
    fieldOnChange: (value: string) => void,
  ) => {
    fieldOnChange(newCountry);
    // Automatically set the default currency for this country
    const newDefaultCurrency = getDefaultCurrencyForCountry(newCountry);
    form.setFieldValue('currency', newDefaultCurrency);
  };

  return (
    <div className="space-y-6">
      <form.AppForm>
        <form.Form className="space-y-6">
          <RootError error={rootError} />

          {/* Store Info */}
          <Card>
            <CardHeader>
              <CardTitle>{t('storeSettings.generalInfo')}</CardTitle>
              <CardDescription>
                {t('storeSettings.generalInfoDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form.AppField name="name">
                {(field) => (
                  <field.Input label={`${t('storeSettings.name')} *`} />
                )}
              </form.AppField>

              <form.Field name="description">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>
                      {t('storeSettings.descriptionLabel')}
                    </Label>
                    <RichTextEditor
                      value={field.state.value || ''}
                      onChange={(value) => field.handleChange(value)}
                      placeholder={t('storeSettings.descriptionPlaceholder')}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <form.AppField name="email">
                  {(field) => (
                    <field.Input
                      label={t('storeSettings.email')}
                      type="email"
                      placeholder="contact@example.com"
                    />
                  )}
                </form.AppField>

                <form.AppField name="phone">
                  {(field) => (
                    <field.Input
                      label={t('storeSettings.phone')}
                      placeholder="01 23 45 67 89"
                    />
                  )}
                </form.AppField>
              </div>

              <form.Field name="address">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>
                      {t('storeSettings.address')}
                    </Label>
                    <AddressInput
                      value={field.state.value || ''}
                      latitude={latitude}
                      longitude={longitude}
                      onChange={(address, lat, lng, displayAddr) => {
                        // Use displayAddress if provided, otherwise use the raw address
                        field.handleChange(displayAddr || address);
                        form.setFieldValue('latitude', lat);
                        form.setFieldValue('longitude', lng);
                      }}
                      placeholder={t('storeSettings.addressPlaceholder')}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="country">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>
                        {t('storeSettings.country')}
                      </Label>
                      <Select
                        onValueChange={(value) => {
                          if (value !== null)
                            handleCountryChange(value, field.handleChange);
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {field.state.value && (
                              <span className="flex items-center gap-2">
                                <span>{getCountryFlag(field.state.value)}</span>
                                <span>{getCountryName(field.state.value)}</span>
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {getCountriesSortedByName().map((country) => (
                            <SelectItem key={country.code} value={country.code}>
                              <span className="flex items-center gap-2">
                                <span>{country.flag}</span>
                                <span>{getCountryName(country.code)}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">
                          {getFieldError(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>

                <form.Field name="currency">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>
                        {t('storeSettings.currency')}
                      </Label>
                      <Select
                        onValueChange={(value) => {
                          if (value !== null) field.handleChange(value);
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {field.state.value && (
                              <span className="flex items-center gap-2">
                                <span>
                                  {getCurrencyByCode(
                                    field.state.value as CurrencyCode,
                                  )?.symbol || field.state.value}
                                </span>
                                <span>
                                  {getCurrencyByCode(
                                    field.state.value as CurrencyCode,
                                  )?.name || field.state.value}
                                </span>
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {SUPPORTED_CURRENCIES.map((currency) => (
                            <SelectItem
                              key={currency.code}
                              value={currency.code}
                            >
                              <span className="flex items-center gap-2">
                                <span className="w-8 text-center">
                                  {currency.symbol}
                                </span>
                                <span>
                                  {currency.name} ({currency.code})
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">
                          {getFieldError(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-muted-foreground shrink-0 text-sm">
                    {t('storeSettings.storeUrl')}
                  </span>
                  <code className="truncate font-mono text-sm">
                    {store.slug}.{domain}
                  </code>
                  <a
                    href={`https://${store.slug}.${domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsSlugModalOpen(true)}
                  className="ml-2 shrink-0"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Billing Address */}
          <Card>
            <CardHeader>
              <CardTitle>{t('billingAddress.title')}</CardTitle>
              <CardDescription>
                {t('billingAddress.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form.AppField name="billingAddressSameAsStore">
                {(field) => (
                  <field.Checkbox
                    label={t('billingAddress.sameAsStore')}
                    description={t('billingAddress.sameAsStoreDescription')}
                  />
                )}
              </form.AppField>

              {/* Conditional billing address fields */}
              {!billingAddressSameAsStore && (
                <div className="animate-in fade-in-0 slide-in-from-top-2 space-y-4 duration-200">
                  <form.AppField name="billingAddress">
                    {(field) => (
                      <field.Input
                        label={t('billingAddress.address')}
                        placeholder={t('billingAddress.addressPlaceholder')}
                      />
                    )}
                  </form.AppField>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <form.AppField name="billingPostalCode">
                      {(field) => (
                        <field.Input
                          label={t('billingAddress.postalCode')}
                          placeholder={t(
                            'billingAddress.postalCodePlaceholder',
                          )}
                        />
                      )}
                    </form.AppField>

                    <form.AppField name="billingCity">
                      {(field) => (
                        <field.Input
                          label={t('billingAddress.city')}
                          placeholder={t('billingAddress.cityPlaceholder')}
                        />
                      )}
                    </form.AppField>
                  </div>

                  <form.Field name="billingCountry">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name}>
                          {t('billingAddress.country')}
                        </Label>
                        <Select
                          onValueChange={(value) => {
                            if (value !== null) field.handleChange(value);
                          }}
                          value={field.state.value}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {field.state.value && (
                                <span className="flex items-center gap-2">
                                  <span>
                                    {getCountryFlag(field.state.value)}
                                  </span>
                                  <span>
                                    {getCountryName(field.state.value)}
                                  </span>
                                </span>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {getCountriesSortedByName().map((country) => (
                              <SelectItem
                                key={country.code}
                                value={country.code}
                              >
                                <span className="flex items-center gap-2">
                                  <span>{country.flag}</span>
                                  <span>{getCountryName(country.code)}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">
                            {getFieldError(field.state.meta.errors[0])}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>

                  {/* Preview of billing address */}
                  {(billingAddressValue || billingCity) && (
                    <div className="bg-muted/50 rounded-lg p-4 text-sm">
                      <p className="text-muted-foreground mb-1 font-medium">
                        {t('billingAddress.preview')}
                      </p>
                      <p>{billingAddressValue}</p>
                      {(billingPostalCode || billingCity) && (
                        <p>
                          {billingPostalCode} {billingCity}
                        </p>
                      )}
                      {billingCountry && (
                        <p>{getCountryName(billingCountry)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Info about what address will be shown on contracts */}
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950/50">
                <p className="text-blue-800 dark:text-blue-200">
                  {billingAddressSameAsStore
                    ? t('billingAddress.infoSameAddress')
                    : t('billingAddress.infoDifferentAddress')}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Reservation Settings */}
          <Card>
            <CardHeader>
              <CardTitle>{t('reservationSettings.title')}</CardTitle>
              <CardDescription>
                {t('reservationSettings.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="reservationMode">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor={field.name}>
                        {t('reservationSettings.mode')}
                      </Label>
                      <Select
                        onValueChange={(value) => {
                          if (value === null) return;
                          if (value === 'payment' && !stripeChargesEnabled) {
                            setIsStripeRequiredDialogOpen(true);
                            return;
                          }
                          field.handleChange(value);
                        }}
                        value={field.state.value}
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {field.state.value === 'payment'
                              ? t('reservationSettings.modePayment')
                              : t('reservationSettings.modeRequest')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="payment" label={t('reservationSettings.modePayment')}>
                            {t('reservationSettings.modePayment')}
                          </SelectItem>
                          <SelectItem value="request" label={t('reservationSettings.modeRequest')}>
                            {t('reservationSettings.modeRequest')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-muted-foreground text-sm">
                        {field.state.value === 'payment'
                          ? t('reservationSettings.modePaymentDescription')
                          : t('reservationSettings.modeRequestDescription')}
                      </p>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-destructive text-sm">
                          {getFieldError(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>

              </div>

              {/* Pending blocks availability - only shown in request mode */}
              {reservationMode === 'request' && (
                <form.AppField name="pendingBlocksAvailability">
                  {(field) => (
                    <field.Switch
                      label={t('reservationSettings.pendingBlocksAvailability')}
                      description={t(
                        'reservationSettings.pendingBlocksAvailabilityDescription',
                      )}
                    />
                  )}
                </form.AppField>
              )}

              {/* Online payment deposit percentage - only shown in payment mode */}
              {reservationMode === 'payment' && (
                <form.Field name="onlinePaymentDepositPercentage">
                  {(field) => (
                    <div className="rounded-lg border p-4">
                      <div className="flex flex-row items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor={field.name} className="text-base">
                            {t('reservationSettings.depositPercentage')}
                          </Label>
                          <p className="text-muted-foreground text-sm">
                            {field.state.value === 100
                              ? t('reservationSettings.depositPercentageFull')
                              : t(
                                  'reservationSettings.depositPercentagePartial',
                                  { percentage: field.state.value },
                                )}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <Slider
                            value={field.state.value}
                            onValueChange={(v) =>
                              field.handleChange(Array.isArray(v) ? v[0] : v)
                            }
                            min={10}
                            max={100}
                            step={5}
                            className="w-28"
                          />
                          <span className="w-12 text-right text-sm font-medium tabular-nums">
                            {field.state.value}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </form.Field>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="minRentalMinutes">
                  {(field) => {
                    const displayValue =
                      minDurationUnit === 'days'
                        ? Math.round(field.state.value / 1440)
                        : Math.round(field.state.value / 60);
                    return (
                      <div className="grid gap-2">
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor={field.name}>
                            {t('reservationSettings.minRentalHours')}
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Info className="text-muted-foreground h-3.5 w-3.5 cursor-help" />
                                }
                              />
                              <TooltipContent side="top" className="max-w-xs">
                                <p>
                                  {t('reservationSettings.minRentalHoursHelp')}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="border-input dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 flex h-9 rounded-md border bg-transparent shadow-xs has-[:focus]:ring-[3px]">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="min-w-0 flex-1 [appearance:textfield] rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            value={displayValue || ''}
                            onChange={(e) => {
                              if (e.target.value === '') {
                                field.handleChange(0);
                                return;
                              }
                              const raw = parseInt(e.target.value);
                              if (!isNaN(raw)) {
                                field.handleChange(
                                  minDurationUnit === 'days' ? raw * 1440 : raw * 60,
                                );
                              }
                            }}
                          />
                          <select
                            className="border-input bg-muted/50 text-muted-foreground h-full cursor-pointer rounded-r-md border-l px-2.5 text-sm outline-none"
                            value={minDurationUnit}
                            onChange={(e) => {
                              const unit = e.target.value as 'hours' | 'days';
                              if (unit === 'days') {
                                const days = Math.round(field.state.value / 1440);
                                field.handleChange(days * 1440);
                              }
                              setMinDurationUnit(unit);
                            }}
                          >
                            <option value="hours">
                              {tCommon('hourUnit', { count: 2 })}
                            </option>
                            <option value="days">
                              {tCommon('dayUnit', { count: 2 })}
                            </option>
                          </select>
                        </div>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">
                            {getFieldError(field.state.meta.errors[0])}
                          </p>
                        )}
                      </div>
                    );
                  }}
                </form.Field>

                <form.Field name="advanceNoticeMinutes">
                  {(field) => {
                    const displayValue =
                      advanceNoticeUnit === 'days'
                        ? Math.round(field.state.value / 1440)
                        : Math.round(field.state.value / 60);
                    return (
                      <div className="grid gap-2">
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor={field.name}>
                            {t('reservationSettings.leadTime')}
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Info className="text-muted-foreground h-3.5 w-3.5 cursor-help" />
                                }
                              />
                              <TooltipContent side="top" className="max-w-xs">
                                <p>{t('reservationSettings.leadTimeHelp')}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="border-input dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 flex h-9 rounded-md border bg-transparent shadow-xs has-[:focus]:ring-[3px]">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="min-w-0 flex-1 [appearance:textfield] rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            value={displayValue || ''}
                            onChange={(e) => {
                              if (e.target.value === '') {
                                field.handleChange(0);
                                return;
                              }
                              const raw = parseInt(e.target.value);
                              if (!isNaN(raw)) {
                                field.handleChange(
                                  advanceNoticeUnit === 'days' ? raw * 1440 : raw * 60,
                                );
                              }
                            }}
                          />
                          <select
                            className="border-input bg-muted/50 text-muted-foreground h-full cursor-pointer rounded-r-md border-l px-2.5 text-sm outline-none"
                            value={advanceNoticeUnit}
                            onChange={(e) => {
                              const unit = e.target.value as 'hours' | 'days';
                              if (unit === 'days') {
                                const days = Math.round(field.state.value / 1440);
                                field.handleChange(days * 1440);
                              }
                              setAdvanceNoticeUnit(unit);
                            }}
                          >
                            <option value="hours">
                              {tCommon('hourUnit', { count: 2 })}
                            </option>
                            <option value="days">
                              {tCommon('dayUnit', { count: 2 })}
                            </option>
                          </select>
                        </div>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-destructive text-sm">
                            {getFieldError(field.state.meta.errors[0])}
                          </p>
                        )}
                      </div>
                    );
                  }}
                </form.Field>
              </div>

              <form.AppField name="requireCustomerAddress">
                {(field) => (
                  <field.Switch
                    label={t('reservationSettings.requireAddress')}
                    description={t(
                      'reservationSettings.requireAddressDescription',
                    )}
                  />
                )}
              </form.AppField>
            </CardContent>
          </Card>

          <FloatingSaveBar
            isDirty={isDirty}
            isLoading={isPending}
            onReset={() => form.reset()}
          />
        </form.Form>
      </form.AppForm>

      <SlugChangeModal
        open={isSlugModalOpen}
        onOpenChange={setIsSlugModalOpen}
        currentSlug={store.slug}
        domain={domain}
      />

      {/* Stripe Required Dialog */}
      <Dialog
        open={isStripeRequiredDialogOpen}
        onOpenChange={setIsStripeRequiredDialogOpen}
      >
        <DialogPopup className="sm:max-w-md">
          <DialogHeader className="space-y-4">
            <div className="bg-primary/10 mx-auto flex h-14 w-14 items-center justify-center rounded-full">
              <CreditCard className="text-primary h-7 w-7" />
            </div>
            <div className="space-y-2 text-center">
              <DialogTitle>
                {t('reservationSettings.stripeRequired.title')}
              </DialogTitle>
              <DialogDescription>
                {t('reservationSettings.stripeRequired.description')}
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogPanel>
            <div className="border-primary/20 bg-primary/5 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">
                {t('reservationSettings.stripeRequired.benefits')}
              </p>
            </div>
          </DialogPanel>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              render={<Link href="/dashboard/settings/payments" />}
              className="w-full"
            >
              {t('reservationSettings.stripeRequired.configureStripe')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground w-full"
              onClick={() => setIsStripeRequiredDialogOpen(false)}
            >
              {t('reservationSettings.stripeRequired.keepRequest')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
