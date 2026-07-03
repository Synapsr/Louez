'use client';

import { useMemo } from 'react';

import Link from 'next/link';

import { Warehouse } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';

import { UnitTrackingEditor } from '@/components/dashboard/unit-tracking-editor';

import type { ProductFormComponentApi, ProductFormValues } from '../types';

type QuantityFieldMeta = {
  errorMap?: Record<string, unknown>;
};

interface ProductFormSectionStockProps {
  form: ProductFormComponentApi;
  productId?: string;
  watchedValues: ProductFormValues;
  disabled?: boolean;
  showValidationErrors?: boolean;
}

export function ProductFormSectionStock({
  form,
  productId,
  watchedValues,
  disabled,
  showValidationErrors = false,
}: ProductFormSectionStockProps) {
  const t = useTranslations('dashboard.products.form');
  const tInventory = useTranslations('dashboard.inventory.productScoped');

  // "Vélo gravel VFD" → "VELO-" : accent-stripped first word, used as the
  // suggested reference prefix for generated units.
  const defaultPrefix = useMemo(() => {
    const firstWord = (watchedValues.name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)[0]
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 6);
    return firstWord ? `${firstWord}-` : '';
  }, [watchedValues.name]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{t('stock')}</CardTitle>
          <CardDescription>{t('quantityHelp')}</CardDescription>
        </div>
        {productId ? (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link href={`/dashboard/inventory?productId=${productId}`} />
            }
          >
            <Warehouse className="h-4 w-4" />
            {tInventory('openInventory')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <UnitTrackingEditor
          trackUnits={watchedValues.trackUnits || false}
          onTrackUnitsChange={(value) =>
            form.setFieldValue('trackUnits', value)
          }
          bookingAttributeAxes={watchedValues.bookingAttributeAxes || []}
          onBookingAttributeAxesChange={(axes) =>
            form.setFieldValue('bookingAttributeAxes', axes)
          }
          units={watchedValues.units || []}
          onChange={(units) => form.setFieldValue('units', units)}
          quantity={watchedValues.quantity || '1'}
          onQuantityChange={(value) => {
            form.setFieldMeta(
              'quantity',
              (prev: QuantityFieldMeta | undefined) => ({
                ...prev,
                errorMap: { ...prev?.errorMap, onSubmit: undefined },
              }),
            );
            form.setFieldValue('quantity', value);
          }}
          defaultPrefix={defaultPrefix}
          disabled={disabled}
          showValidationErrors={showValidationErrors}
        />
      </CardContent>
    </Card>
  );
}
