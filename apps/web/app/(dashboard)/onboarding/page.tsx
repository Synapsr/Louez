'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { Globe, Store } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Label } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { type StoreInfoInput, createStoreInfoSchema } from '@louez/validations';

import { FormRadioCardGroup } from '@/components/form/form-radio-card-group';
import { FormStoreNameSlug } from '@/components/form/form-store-name-slug';
import { AddressInput } from '@/components/ui/address-input';

import {
  SUPPORTED_COUNTRIES,
  getCountriesSortedByName,
  getCountryByCode,
  getCountryName,
} from '@/lib/utils/countries';
import {
  SUPPORTED_CURRENCIES,
  getDefaultCurrencyForCountry,
} from '@/lib/utils/currency';

import { useAppForm } from '@/hooks/form/form';

import { env } from '@/env';

import { createStore } from './actions';

const FALLBACK_COUNTRY = 'FR';

function extractRegionCode(locale: string): string | null {
  const normalizedLocale = locale.replace('_', '-');

  try {
    const region = new Intl.Locale(normalizedLocale).region;
    return region?.toUpperCase() ?? null;
  } catch {
    const parts = normalizedLocale.split('-');
    const possibleRegion = parts.at(-1)?.toUpperCase();

    if (!possibleRegion || possibleRegion.length !== 2) {
      return null;
    }

    return possibleRegion;
  }
}

function getBrowserLocaleCandidates(): string[] {
  if (typeof navigator === 'undefined') return [];

  return [navigator.language, ...(navigator.languages ?? [])].filter(
    (locale): locale is string => Boolean(locale),
  );
}

function getBrowserTimezone(): string | null {
  if (typeof Intl === 'undefined') return null;

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function getCountryFromTimezone(timezone: string | null): string | null {
  if (!timezone) return null;

  return (
    SUPPORTED_COUNTRIES.find((country) => country.timezone === timezone)?.code ??
    null
  );
}

interface BrowserCountryDetection {
  country: string;
  source: 'timezone' | 'locale-region' | 'language-map' | 'fallback';
  localeCandidates: string[];
  timezone: string | null;
  matchedLocaleRegion: string | null;
}

/**
 * Detect country from browser locale preferences.
 */
function detectCountryFromBrowser(): BrowserCountryDetection {
  const localeCandidates = getBrowserLocaleCandidates();
  const timezone = getBrowserTimezone();
  const timezoneCountry = getCountryFromTimezone(timezone);

  if (timezoneCountry) {
    return {
      country: timezoneCountry,
      source: 'timezone',
      localeCandidates,
      timezone,
      matchedLocaleRegion: null,
    };
  }

  for (const locale of localeCandidates) {
    const regionCode = extractRegionCode(locale);
    if (regionCode && getCountryByCode(regionCode)) {
      return {
        country: regionCode,
        source: 'locale-region',
        localeCandidates,
        timezone,
        matchedLocaleRegion: regionCode,
      };
    }
  }

  const primaryLanguage = localeCandidates[0]?.split(/[-_]/)[0]?.toLowerCase();
  const langToCountry: Record<string, string> = {
    fr: 'FR',
    en: 'US',
    de: 'DE',
    es: 'ES',
    it: 'IT',
    nl: 'NL',
    pl: 'PL',
    pt: 'PT',
    ja: 'JP',
    zh: 'CN',
    ko: 'KR',
  };

  if (primaryLanguage && langToCountry[primaryLanguage]) {
    return {
      country: langToCountry[primaryLanguage],
      source: 'language-map',
      localeCandidates,
      timezone,
      matchedLocaleRegion: null,
    };
  }

  return {
    country: FALLBACK_COUNTRY,
    source: 'fallback',
    localeCandidates,
    timezone,
    matchedLocaleRegion: null,
  };
}

function getBrowserLanguage(): string {
  const localeCandidate = getBrowserLocaleCandidates()[0] ?? 'fr';
  return localeCandidate.split(/[-_]/)[0]?.toLowerCase() || 'fr';
}

export default function OnboardingStorePage() {
  const router = useRouter();
  const t = useTranslations('onboarding.store');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const tValidation = useTranslations('validation');

  const storeInfoSchema = createStoreInfoSchema(tValidation);

  const mutation = useMutation({
    mutationFn: async (value: StoreInfoInput) => {
      const result = await createStore(value);
      if (result.error) {
        throw new Error(result.error);
      }
      return result;
    },
  });

  const setSlugTakenError = () => {
    form.setFieldMeta('slug', (prev) => ({
      ...prev,
      isTouched: true,
      errorMap: {
        ...prev.errorMap,
        onSubmit: tErrors('slugTaken'),
      },
    }));
  };

  const clearSlugSubmitError = () => {
    form.setFieldMeta('slug', (prev) => ({
      ...prev,
      errorMap: {
        ...prev.errorMap,
        onSubmit: undefined,
      },
    }));
  };

  const form = useAppForm({
    defaultValues: {
      name: '',
      slug: '',
      pricingMode: 'day' as 'day' | 'hour',
      country: FALLBACK_COUNTRY,
      currency: getDefaultCurrencyForCountry(FALLBACK_COUNTRY) as string,
      address: '',
      latitude: null as number | null,
      longitude: null as number | null,
      email: '',
      phone: '',
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: {
      onSubmit: storeInfoSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(value);
        router.push('/onboarding/branding');
      } catch (error) {
        if (error instanceof Error) {
          // Map server errors to field-level errors
          if (error.message === 'errors.slugTaken') {
            setSlugTakenError();
            return;
          }
          // Generic errors as toast
          const msg = error.message.startsWith('errors.')
            ? tErrors(error.message.replace('errors.', ''))
            : tErrors('generic');
          toastManager.add({ title: msg, type: 'error' });
        }
      }
    },
  });

  const hasAppliedBrowserDefaults = useRef(false);

  useEffect(() => {
    if (hasAppliedBrowserDefaults.current) return;

    const detection = detectCountryFromBrowser();
    const detectedCurrency = getDefaultCurrencyForCountry(detection.country);

    form.setFieldValue('country', detection.country);
    form.setFieldValue('currency', detectedCurrency);

    hasAppliedBrowserDefaults.current = true;
  }, [form]);

  const latitude = useStore(form.store, (s) => s.values.latitude);
  const longitude = useStore(form.store, (s) => s.values.longitude);
  const domain = env.NEXT_PUBLIC_APP_DOMAIN;

  const handleCountryChange = (
    newCountry: string,
    onChange: (value: string) => void,
  ) => {
    onChange(newCountry);
    form.setFieldValue('currency', getDefaultCurrencyForCountry(newCountry));
  };

  const locale = getBrowserLanguage();
  const sortedCountries = getCountriesSortedByName(locale);
  const sortedCurrencies = SUPPORTED_CURRENCIES.slice().sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Store className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
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

            <form.Field name="pricingMode">
              {(field) => (
                <FormRadioCardGroup<'day' | 'hour'>
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onChange={field.handleChange}
                  options={[
                    {
                      value: 'day',
                      label: t('pricingDay'),
                      description: t('pricingDayDesc'),
                    },
                    {
                      value: 'hour',
                      label: t('pricingHour'),
                      description: t('pricingHourDesc'),
                    },
                  ]}
                  label={t('pricingMode')}
                  helpText={t('pricingModeHelp')}
                />
              )}
            </form.Field>

            {/* Location & Contact Section */}
            <div className="space-y-4 border-t pt-4">
              <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <Globe className="h-4 w-4" />
                {t('locationSection')}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <form.Field name="country">
                  {(field) => (
                    <div className="grid gap-2">
                      <Label htmlFor="country">{t('country')}</Label>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => {
                          if (value !== null)
                            handleCountryChange(value, (v: string) =>
                              field.handleChange(v),
                            );
                        }}
                      >
                        <SelectTrigger id="country">
                          <SelectValue placeholder={t('countryPlaceholder')} />
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
                              >
                                <span className="sr-only">
                                  {countryName}
                                </span>
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
                          {String(field.state.meta.errors[0])}
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
                    >
                      {sortedCurrencies.map((currency) => (
                        <SelectItem key={currency.code} value={currency.code}>
                          {currency.symbol} {currency.name} ({currency.code})
                        </SelectItem>
                      ))}
                    </field.Select>
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
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

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
                    <field.Input
                      label={t('contactPhone')}
                      type="tel"
                      placeholder={t('phonePlaceholder')}
                    />
                  )}
                </form.AppField>
              </div>
            </div>

            <form.SubscribeButton className="w-full">
              {tCommon('next')}
            </form.SubscribeButton>
          </form.Form>
        </form.AppForm>
      </CardContent>
    </Card>
  );
}
