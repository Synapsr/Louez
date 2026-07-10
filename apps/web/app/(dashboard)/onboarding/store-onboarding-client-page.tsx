'use client';

import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Label } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';

import { StoreSwitcher } from '@/components/dashboard/store-switcher';
import { FormStoreNameSlug } from '@/components/form/form-store-name-slug';
import { AddressInput } from '@/components/ui/address-input';

import {
  getCountriesSortedByName,
  getCountryName,
} from '@/lib/utils/countries';
import { SUPPORTED_CURRENCIES } from '@/lib/utils/currency';
import { getBrowserLanguage } from '@/lib/utils/util.browser-country-detection';

import { getFieldError } from '@/hooks/form/form-context';

import { env } from '@/env';

import { OnboardingStepHeader } from './_components/step-header';
import { useStoreStep } from './use-store-step';

interface StoreWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: 'owner' | 'member' | 'platform_admin';
}

interface StoreOnboardingClientPageProps {
  stores: StoreWithRole[];
  currentStoreId: string | null;
}

export function StoreOnboardingClientPage({
  stores,
  currentStoreId,
}: StoreOnboardingClientPageProps) {
  const t = useTranslations('onboarding.store');
  const tCommon = useTranslations('common');
  const {
    form,
    clearSlugSubmitError,
    handleCountryChange,
    country,
    latitude,
    longitude,
  } = useStoreStep();

  const domain = env.NEXT_PUBLIC_APP_DOMAIN;
  const locale = getBrowserLanguage();
  const sortedCountries = getCountriesSortedByName(locale);
  const currencyItems = SUPPORTED_CURRENCIES.slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((currency) => ({
      value: currency.code,
      label: `${currency.symbol} ${currency.name} (${currency.code})`,
    }));
  const canSwitchAccount = Boolean(currentStoreId && stores.length > 0);

  return (
    <>
      {canSwitchAccount && currentStoreId && (
        <div className="mb-6">
          <StoreSwitcher stores={stores} currentStoreId={currentStoreId} />
        </div>
      )}
      <OnboardingStepHeader title={t('title')} description={t('description')} />
      <form.AppForm>
        <form.Form className="space-y-6">
          {/* Store Name + Slug Preview */}
          <form.Field name="name">
            {(nameField) => (
              <form.Field name="slug">
                {(slugField) => (
                  <FormStoreNameSlug
                    nameValue={nameField.state.value}
                    nameErrors={nameField.state.meta.errors}
                    slugValue={slugField.state.value}
                    slugErrors={slugField.state.meta.errors}
                    onNameChange={nameField.handleChange}
                    onNameBlur={nameField.handleBlur}
                    onSlugChange={(value) => {
                      clearSlugSubmitError();
                      slugField.handleChange(value);
                    }}
                    label={t('name')}
                    namePlaceholder={t('namePlaceholder')}
                    slugPlaceholder={t('slugPlaceholder')}
                    slugDefault={t('slugDefault')}
                    domain={domain}
                    confirmAriaLabel={tCommon('confirm')}
                    cancelAriaLabel={tCommon('cancel')}
                  />
                )}
              </form.Field>
            )}
          </form.Field>

          {/* Location & Contact Section */}
          <div className="space-y-4 border-t pt-4">
            {/* <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4" />
              {t('locationSection')}
            </div> */}
            <div className="grid grid-cols-2 gap-4">
              <form.Field name="country">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor="country">{t('country')}</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => {
                        if (value !== null) handleCountryChange(value);
                      }}
                    >
                      <SelectTrigger id="country">
                        <SelectValue placeholder={t('countryPlaceholder')}>
                          {field.state.value &&
                            (() => {
                              const selectedCountry = sortedCountries.find(
                                (c) => c.code === field.state.value,
                              );
                              const countryName = getCountryName(
                                field.state.value,
                                locale,
                              );
                              return selectedCountry ? (
                                <span className="inline-flex items-center gap-2">
                                  <span>{selectedCountry.flag}</span>
                                  <span>{countryName}</span>
                                </span>
                              ) : null;
                            })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {sortedCountries.map((country) => {
                          const countryName = getCountryName(
                            country.code,
                            locale,
                          );

                          return (
                            <SelectItem
                              key={country.code}
                              value={country.code}
                              label={countryName}
                            >
                              <span className="sr-only">{countryName}</span>
                              <span
                                aria-hidden
                                className="inline-flex items-center gap-2"
                              >
                                <span>{country.flag}</span>
                                <span>{countryName}</span>
                              </span>
                            </SelectItem>
                          );
                        })}
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

              <form.AppField name="currency">
                {(field) => (
                  <field.Select
                    label={t('currency')}
                    placeholder={t('currencyPlaceholder')}
                    items={currencyItems}
                  >
                    {currencyItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </field.Select>
                )}
              </form.AppField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <form.AppField name="email">
                {(field) => (
                  <field.Input
                    label={t('contactEmail')}
                    type="email"
                    placeholder={t('emailPlaceholder')}
                  />
                )}
              </form.AppField>

              <form.AppField name="phone">
                {(field) => (
                  <field.PhoneInput
                    label={t('contactPhone')}
                    defaultCountry={country}
                    placeholder={t('phonePlaceholder')}
                  />
                )}
              </form.AppField>
            </div>
            <form.Field name="address">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="address">{t('address')}</Label>
                  <AddressInput
                    value={field.state.value || ''}
                    latitude={latitude}
                    longitude={longitude}
                    onChange={(address, lat, lng) => {
                      field.handleChange(address);
                      form.setFieldValue('latitude', lat);
                      form.setFieldValue('longitude', lng);
                    }}
                    placeholder={t('addressPlaceholder')}
                  />
                  <p className="text-muted-foreground text-sm">
                    {t('addressHelp')}
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

          <form.SubscribeButton className="mt-2 w-full">
            {tCommon('next')}
          </form.SubscribeButton>
        </form.Form>
      </form.AppForm>
    </>
  );
}
