'use client';

import { Link2, Puzzle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';

import { AccessoriesSelector } from '@/components/dashboard/accessories-selector';
import { getFieldError } from '@/hooks/form/form-context';

import type { AvailableAccessory, ProductFormComponentApi } from '../types';

interface ProductFormSectionAccessoriesProps {
  form: ProductFormComponentApi;
  availableAccessories: AvailableAccessory[];
  currency: string;
  disabled?: boolean;
}

export function ProductFormSectionAccessories({
  form,
  availableAccessories,
  currency,
  disabled,
}: ProductFormSectionAccessoriesProps) {
  const t = useTranslations('dashboard.products.form');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          {t('accessories')}
        </CardTitle>
        <CardDescription>{t('accessoriesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {availableAccessories.length > 0 ? (
          <form.Field name="accessoryIds">
            {(field) => (
              <div>
                <AccessoriesSelector
                  availableProducts={availableAccessories}
                  selectedIds={field.state.value || []}
                  onChange={field.handleChange}
                  currency={currency}
                  disabled={disabled}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="bg-muted mb-3 rounded-full p-3">
              <Puzzle className="text-muted-foreground h-6 w-6" />
            </div>
            <p className="text-sm font-medium">
              {t('noAccessoriesAvailable')}
            </p>
            <p className="text-muted-foreground mt-1 max-w-[260px] text-sm">
              {t('noAccessoriesHint')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
