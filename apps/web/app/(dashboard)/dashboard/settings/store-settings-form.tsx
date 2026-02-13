'use client';

import { useState } from 'react';
import { useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useStore } from '@tanstack/react-form';
import {
  ArrowRight,
  CreditCard,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { z } from 'zod';

import type { StoreSettings } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogPanel,
} from '@louez/ui';

import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar';
import { RootError } from '@/components/form/root-error';

import {
  getMaxRentalMinutes,
  getMinRentalMinutes,
} from '@/lib/utils/rental-duration';
import { getDefaultCurrencyForCountry } from '@/lib/utils/currency';

import { useAppForm } from '@/hooks/form/form';

import { env } from '@/env';

import { updateStoreSettings } from './actions';
import { StoreSettingsBillingSection } from './components/store-settings-billing-section';
import { StoreSettingsIdentitySection } from './components/store-settings-identity-section';
import { StoreSettingsRentalRulesSection } from './components/store-settings-rental-rules-section';
import { useStoreSettingsUnits } from './hooks/use-store-settings-units';
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
  const t = useTranslations('dashboard.settings');

  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
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
  const units = useStoreSettingsUnits({
    minRentalMinutes: minRentalMinutesInit,
    advanceNoticeMinutes: advanceNoticeMinutesInit,
  });

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
  const reservationMode = useStore(form.store, (state) => state.values.reservationMode);
  const latitude = useStore(form.store, (state) => state.values.latitude);
  const longitude = useStore(form.store, (state) => state.values.longitude);
  const billingAddressSameAsStore = useStore(
    form.store,
    (state) => state.values.billingAddressSameAsStore,
  );
  const billingAddressValue = useStore(
    form.store,
    (state) => state.values.billingAddress,
  );
  const billingCity = useStore(form.store, (state) => state.values.billingCity);
  const billingPostalCode = useStore(
    form.store,
    (state) => state.values.billingPostalCode,
  );
  const billingCountry = useStore(form.store, (state) => state.values.billingCountry);

  return (
    <div className="space-y-6">
      <form.AppForm>
        <form.Form className="space-y-6">
          <RootError error={rootError} />

          <StoreSettingsIdentitySection
            form={form}
            storeSlug={store.slug}
            domain={domain}
            latitude={latitude}
            longitude={longitude}
            onOpenSlugModal={() => setIsSlugModalOpen(true)}
          />

          <StoreSettingsBillingSection
            form={form}
            billingAddressSameAsStore={billingAddressSameAsStore}
            billingAddress={billingAddressValue}
            billingCity={billingCity}
            billingPostalCode={billingPostalCode}
            billingCountry={billingCountry}
          />

          <StoreSettingsRentalRulesSection
            form={form}
            stripeChargesEnabled={stripeChargesEnabled}
            reservationMode={reservationMode}
            onStripeRequired={() => setIsStripeRequiredDialogOpen(true)}
            units={units}
          />

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
