'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui';

import { UnitTrackingEditor } from '@/components/dashboard/unit-tracking-editor';

import type { ProductFormComponentApi, ProductFormValues } from '../types';

interface ProductFormSectionStockProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  disabled?: boolean;
  showValidationErrors?: boolean;
}

export function ProductFormSectionStock({
  form,
  watchedValues,
  disabled,
  showValidationErrors = false,
}: ProductFormSectionStockProps) {
  const t = useTranslations('dashboard.products.form');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('stock')}</CardTitle>
        <CardDescription>{t('quantityHelp')}</CardDescription>
      </CardHeader>
      <CardContent>
        <UnitTrackingEditor
          trackUnits={watchedValues.trackUnits || false}
          onTrackUnitsChange={(value) => form.setFieldValue('trackUnits', value)}
          bookingAttributeAxes={watchedValues.bookingAttributeAxes || []}
          onBookingAttributeAxesChange={(axes) =>
            form.setFieldValue('bookingAttributeAxes', axes)
          }
          units={watchedValues.units || []}
          onChange={(units) => form.setFieldValue('units', units)}
          quantity={watchedValues.quantity || '1'}
          onQuantityChange={(value) => {
            form.setFieldMeta('quantity', (prev: any) => ({
              ...prev,
              errorMap: { ...prev?.errorMap, onSubmit: undefined },
            }));
            form.setFieldValue('quantity', value);
          }}
          disabled={disabled}
          showValidationErrors={showValidationErrors}
        />
      </CardContent>
    </Card>
  );
}
