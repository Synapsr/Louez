'use client';

import { ArrowRight, ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Card, CardContent } from '@louez/ui';

import type { CheckoutFormComponentApi } from '../types';

interface CheckoutAddressStepProps {
  form: CheckoutFormComponentApi;
  onBack: () => void;
  onContinue: () => void;
}

export function CheckoutAddressStep({
  form,
  onBack,
  onContinue,
}: CheckoutAddressStepProps) {
  const t = useTranslations('storefront.checkout');

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{t('steps.address')}</h2>
          <p className="text-muted-foreground text-sm">{t('addressDescription')}</p>
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
              <field.Input label={t('city')} placeholder={t('cityPlaceholder')} />
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
            onClick={onBack}
            className="flex-1"
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            {t('back')}
          </Button>
          <Button type="button" onClick={onContinue} className="flex-1">
            {t('continue')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
