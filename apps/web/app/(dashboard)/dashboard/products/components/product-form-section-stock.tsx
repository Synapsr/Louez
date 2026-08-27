'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import type { StockKindChangeBlocker } from '@louez/db';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { ArrowLeftIcon, DatabaseIcon } from '@louez/ui/icons';

import {
  StockModeIndicator,
  UnitTrackingEditor,
} from '@/components/dashboard/unit-tracking-editor';

import type { ProductFormComponentApi, ProductFormValues } from '../types';
import { ProductFormStockKindField } from './product-form-stock-kind-field';

type QuantityFieldMeta = {
  errorMap?: Record<string, unknown>;
};

interface ProductFormSectionStockProps {
  form: ProductFormComponentApi;
  productId?: string;
  stockKindChangeBlockers?: StockKindChangeBlocker[];
  watchedValues: ProductFormValues;
  currency: string;
  disabled?: boolean;
  showValidationErrors?: boolean;
}

export function ProductFormSectionStock({
  form,
  productId,
  stockKindChangeBlockers = [],
  watchedValues,
  currency,
  disabled,
  showValidationErrors = false,
}: ProductFormSectionStockProps) {
  const t = useTranslations('dashboard.products.form');
  const tInventory = useTranslations('dashboard.inventory.productScoped');
  const tUnitTracking = useTranslations('dashboard.products.form.unitTracking');

  // Stock mode stepper: editing an existing product always lands directly on
  // the second step (mode already established).
  const [modeChosen, setModeChosen] = useState(
    () =>
      Boolean(productId) ||
      Boolean(watchedValues.trackUnits) ||
      (watchedValues.units?.length ?? 0) > 0 ||
      (parseInt(watchedValues.quantity || '1', 10) || 1) > 1,
  );

  // A consumable is never tracked unit by unit, so the returnable stepper
  // (quantity vs tracked units) has nothing left to ask.
  const isConsumable = watchedValues.stockKind === 'consumable';
  const isUntracked = watchedValues.stockKind === 'untracked';
  const hasManagedStock = !isUntracked;

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
          <div className="flex items-center gap-2">
            {modeChosen && !isConsumable && hasManagedStock ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground h-6 w-6"
                onClick={() => setModeChosen(false)}
                aria-label={tUnitTracking('changeMode')}
              >
                <ArrowLeftIcon data-slot="icon" />
              </Button>
            ) : null}
            <CardTitle className="flex items-center gap-2">
              {' '}
              <DatabaseIcon className="text-primary h-5 w-5 shrink-0 stroke-2" />
              {t('stock')}
            </CardTitle>
            {isConsumable || !hasManagedStock ? null : (
              <StockModeIndicator
                modeChosen={modeChosen}
                trackUnits={watchedValues.trackUnits || false}
                onBack={() => setModeChosen(false)}
                disabled={disabled}
              />
            )}
          </div>
          <CardDescription>
            {isUntracked
              ? t('untrackedStockHelp')
              : isConsumable
                ? t('consumableQuantityHelp')
                : t('quantityHelp')}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <ProductFormStockKindField
            form={form}
            productId={productId}
            watchedValues={watchedValues}
            disabled={disabled}
            stockKindChangeBlockers={stockKindChangeBlockers}
          />
          {productId && hasManagedStock ? (
            <Button
              variant="outline"
              size="sm"
              render={
                <Link href={`/dashboard/products/${productId}`} />
              }
            >
              <DatabaseIcon className="h-4 w-4" />
              {tInventory('openInventory')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {hasManagedStock ? (
        <CardContent className="space-y-6">
          <UnitTrackingEditor
            currency={currency}
            trackUnits={!isConsumable && (watchedValues.trackUnits || false)}
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
            modeChosen={isConsumable || modeChosen}
            onModeChosenChange={setModeChosen}
            defaultPrefix={defaultPrefix}
            disabled={disabled}
            showValidationErrors={showValidationErrors}
            productId={productId}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}
