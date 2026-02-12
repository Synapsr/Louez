'use client';

import { ExternalLink, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
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

import { AddressInput } from '@/components/ui/address-input';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { getFieldError } from '@/hooks/form/form-context';
import {
  getCountriesSortedByName,
  getCountryFlag,
  getCountryName,
} from '@/lib/utils/countries';
import {
  type CurrencyCode,
  SUPPORTED_CURRENCIES,
  getCurrencyByCode,
  getDefaultCurrencyForCountry,
} from '@/lib/utils/currency';

interface StoreSettingsIdentitySectionProps {
  form: any;
  storeSlug: string;
  domain: string;
  latitude: number | null;
  longitude: number | null;
  onOpenSlugModal: () => void;
}

export function StoreSettingsIdentitySection({
  form,
  storeSlug,
  domain,
  latitude,
  longitude,
  onOpenSlugModal,
}: StoreSettingsIdentitySectionProps) {
  const t = useTranslations('dashboard.settings');

  const handleCountryChange = (
    newCountry: string,
    fieldOnChange: (value: string) => void,
  ) => {
    fieldOnChange(newCountry);
    form.setFieldValue('currency', getDefaultCurrencyForCountry(newCountry));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('storeSettings.generalInfo')}</CardTitle>
        <CardDescription>{t('storeSettings.generalInfoDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form.AppField name="name">
          {(field: any) => <field.Input label={`${t('storeSettings.name')} *`} />}
        </form.AppField>

        <form.Field name="description">
          {(field: any) => (
            <div className="grid gap-2">
              <Label htmlFor={field.name}>{t('storeSettings.descriptionLabel')}</Label>
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
            {(field: any) => (
              <field.Input
                label={t('storeSettings.email')}
                type="email"
                placeholder="contact@example.com"
              />
            )}
          </form.AppField>

          <form.AppField name="phone">
            {(field: any) => (
              <field.Input
                label={t('storeSettings.phone')}
                placeholder="01 23 45 67 89"
              />
            )}
          </form.AppField>
        </div>

        <form.Field name="address">
          {(field: any) => (
            <div className="grid gap-2">
              <Label htmlFor={field.name}>{t('storeSettings.address')}</Label>
              <AddressInput
                value={field.state.value || ''}
                latitude={latitude}
                longitude={longitude}
                onChange={(address, lat, lng, displayAddress) => {
                  field.handleChange(displayAddress || address);
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
            {(field: any) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>{t('storeSettings.country')}</Label>
                <Select
                  onValueChange={(value) => {
                    if (value !== null) {
                      handleCountryChange(value, field.handleChange);
                    }
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
            {(field: any) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>{t('storeSettings.currency')}</Label>
                <Select
                  onValueChange={(value) => {
                    if (value !== null) {
                      field.handleChange(value);
                    }
                  }}
                  value={field.state.value}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {field.state.value && (
                        <span className="flex items-center gap-2">
                          <span>
                            {getCurrencyByCode(field.state.value as CurrencyCode)?.symbol ||
                              field.state.value}
                          </span>
                          <span>
                            {getCurrencyByCode(field.state.value as CurrencyCode)?.name ||
                              field.state.value}
                          </span>
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {SUPPORTED_CURRENCIES.map((currency) => (
                      <SelectItem key={currency.code} value={currency.code}>
                        <span className="flex items-center gap-2">
                          <span className="w-8 text-center">{currency.symbol}</span>
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
              {storeSlug}.{domain}
            </code>
            <a
              href={`https://${storeSlug}.${domain}`}
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
            onClick={onOpenSlugModal}
            className="ml-2 shrink-0"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
