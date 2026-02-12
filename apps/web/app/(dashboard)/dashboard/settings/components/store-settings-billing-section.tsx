'use client';

import { useTranslations } from 'next-intl';

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

import { getFieldError } from '@/hooks/form/form-context';
import {
  getCountriesSortedByName,
  getCountryFlag,
  getCountryName,
} from '@/lib/utils/countries';

interface StoreSettingsBillingSectionProps {
  form: any;
  billingAddressSameAsStore: boolean;
  billingAddress: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
}

export function StoreSettingsBillingSection({
  form,
  billingAddressSameAsStore,
  billingAddress,
  billingCity,
  billingPostalCode,
  billingCountry,
}: StoreSettingsBillingSectionProps) {
  const t = useTranslations('dashboard.settings');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billingAddress.title')}</CardTitle>
        <CardDescription>{t('billingAddress.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form.AppField name="billingAddressSameAsStore">
          {(field: any) => (
            <field.Checkbox
              label={t('billingAddress.sameAsStore')}
              description={t('billingAddress.sameAsStoreDescription')}
            />
          )}
        </form.AppField>

        {!billingAddressSameAsStore && (
          <div className="animate-in fade-in-0 slide-in-from-top-2 space-y-4 duration-200">
            <form.AppField name="billingAddress">
              {(field: any) => (
                <field.Input
                  label={t('billingAddress.address')}
                  placeholder={t('billingAddress.addressPlaceholder')}
                />
              )}
            </form.AppField>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="billingPostalCode">
                {(field: any) => (
                  <field.Input
                    label={t('billingAddress.postalCode')}
                    placeholder={t('billingAddress.postalCodePlaceholder')}
                  />
                )}
              </form.AppField>

              <form.AppField name="billingCity">
                {(field: any) => (
                  <field.Input
                    label={t('billingAddress.city')}
                    placeholder={t('billingAddress.cityPlaceholder')}
                  />
                )}
              </form.AppField>
            </div>

            <form.Field name="billingCountry">
              {(field: any) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t('billingAddress.country')}</Label>
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

            {(billingAddress || billingCity) && (
              <div className="bg-muted/50 rounded-lg p-4 text-sm">
                <p className="text-muted-foreground mb-1 font-medium">
                  {t('billingAddress.preview')}
                </p>
                <p>{billingAddress}</p>
                {(billingPostalCode || billingCity) && (
                  <p>
                    {billingPostalCode} {billingCity}
                  </p>
                )}
                {billingCountry && <p>{getCountryName(billingCountry)}</p>}
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950/50">
          <p className="text-blue-800 dark:text-blue-200">
            {billingAddressSameAsStore
              ? t('billingAddress.infoSameAddress')
              : t('billingAddress.infoDifferentAddress')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
