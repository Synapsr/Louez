'use client';

import { ChevronLeft, CreditCard, Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, Card, CardContent, Checkbox, Label } from '@louez/ui';
import { formatCurrency } from '@louez/utils';

import { getFieldError } from '@/hooks/form/form-context';

import type {
  CheckoutFormComponentApi,
  DeliveryOption,
} from '../types';

interface CheckoutConfirmStepProps {
  form: CheckoutFormComponentApi;
  cgv: string | null;
  deliveryOption: DeliveryOption;
  reservationMode: 'payment' | 'request';
  depositPercentage: number;
  subtotal: number;
  totalWithDelivery: number;
  currency: string;
  tulipInsurance?: {
    enabled: boolean;
    mode: 'required' | 'optional' | 'no_public';
    includeInFinalPrice: boolean;
  };
  canSubmitCheckout: boolean;
  onBack: () => void;
  onEditContact: () => void;
}

export function CheckoutConfirmStep({
  form,
  cgv,
  deliveryOption,
  reservationMode,
  depositPercentage,
  subtotal,
  totalWithDelivery,
  currency,
  tulipInsurance,
  canSubmitCheckout,
  onBack,
  onEditContact,
}: CheckoutConfirmStepProps) {
  const t = useTranslations('storefront.checkout');

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">{t('steps.confirm')}</h2>
          <p className="text-muted-foreground text-sm">{t('confirmDescription')}</p>
        </div>

        <div className="bg-muted/50 space-y-2 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('customerInfo')}</span>
            <Button type="button" variant="ghost" onClick={onEditContact}>
              {t('modify')}
            </Button>
          </div>

          {form.getFieldValue('isBusinessCustomer') &&
            form.getFieldValue('companyName') && (
              <p className="text-sm font-medium">{form.getFieldValue('companyName')}</p>
            )}

          <p className="text-sm">
            {form.getFieldValue('firstName')} {form.getFieldValue('lastName')}
            {form.getFieldValue('isBusinessCustomer') && (
              <span className="text-muted-foreground"> ({t('contact')})</span>
            )}
          </p>
          <p className="text-muted-foreground text-sm">{form.getFieldValue('email')}</p>
          <p className="text-muted-foreground text-sm">{form.getFieldValue('phone')}</p>
          {form.getFieldValue('address') && (
            <p className="text-muted-foreground text-sm">
              {form.getFieldValue('address')}, {form.getFieldValue('postalCode')}{' '}
              {form.getFieldValue('city')}
            </p>
          )}
          {deliveryOption === 'delivery' && (
            <p className="text-muted-foreground text-sm">{t('deliveryOption')}</p>
          )}
        </div>

        <div className="space-y-3">
          {tulipInsurance?.enabled && tulipInsurance.mode === 'required' && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              {t('insuranceRequiredNotice')}
            </div>
          )}

          {tulipInsurance?.enabled && tulipInsurance.mode === 'optional' && (
            <form.Field name="tulipInsuranceOptIn">
              {(field) => (
                <div className="flex flex-row items-start space-y-0 space-x-3 rounded-lg border p-4">
                  <Checkbox
                    id={field.name}
                    checked={field.state.value}
                    onCheckedChange={(checked) => field.handleChange(Boolean(checked))}
                  />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor={field.name} className="cursor-pointer">
                      {t('insuranceOptionalLabel')}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t('insuranceOptionalHelp')}
                    </p>
                  </div>
                </div>
              )}
            </form.Field>
          )}

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
                  onCheckedChange={(checked) => field.handleChange(Boolean(checked))}
                />
                <div className="space-y-1 leading-none">
                  <Label htmlFor={field.name} className="cursor-pointer">
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
          <Button type="button" variant="outline" onClick={onBack}>
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
                            Math.round(subtotal * depositPercentage) / 100,
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
  );
}
