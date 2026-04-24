'use client';

import { ArrowRight, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Card, CardContent, Checkbox, Label } from '@louez/ui';

import { PhoneInput } from '@/components/ui/phone-input';
import { getFieldError } from '@/hooks/form/form-context';

import type { CheckoutFormComponentApi } from '../types';

const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

interface CheckoutContactStepProps {
  form: CheckoutFormComponentApi;
  showAddressFields: boolean;
  isBusinessCustomer: boolean;
  onBusinessCustomerUnchecked: () => void;
  onContinue: () => void;
}

export function CheckoutContactStep({
  form,
  showAddressFields,
  isBusinessCustomer,
  onBusinessCustomerUnchecked,
  onContinue,
}: CheckoutContactStepProps) {
  const t = useTranslations('storefront.checkout');

  const handleDevAutofill = () => {
    form.setFieldValue('firstName', 'Teo');
    form.setFieldValue('lastName', 'Lumy');
    form.setFieldValue('email', 'teo+@lumy.bzh');
    form.setFieldValue('phone', '+33612345678');
    form.setFieldValue('isBusinessCustomer', false);
    form.setFieldValue('companyName', '');
    form.setFieldValue('address', '1 rue de la Location');
    form.setFieldValue('postalCode', '75001');
    form.setFieldValue('city', 'Paris');
    form.setFieldValue('notes', '');
    form.setFieldValue('acceptCgv', true);
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t('steps.contact')}</h2>
            <p className="text-muted-foreground text-sm">{t('contactDescription')}</p>
          </div>
          {IS_DEVELOPMENT && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDevAutofill}
              className="w-fit shrink-0"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Remplir dev
            </Button>
          )}
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

        {showAddressFields && (
          <>
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
          </>
        )}

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
                    onBusinessCustomerUnchecked();
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

        <form.AppField name="notes">
          {(field) => (
            <field.Textarea
              label={t('notes')}
              placeholder={t('notesPlaceholder')}
              rows={3}
            />
          )}
        </form.AppField>

        <div className="pt-4">
          <Button type="button" onClick={onContinue} className="w-full" size="lg">
            {t('continue')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
