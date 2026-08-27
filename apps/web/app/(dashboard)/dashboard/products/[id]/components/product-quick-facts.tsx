import { getTranslations } from 'next-intl/server';
import { Info } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui';
import { formatCurrency } from '@louez/utils';
import type { BookingAttributeAxis, ProductTaxSettings } from '@louez/types';

import { formatDate } from '@/lib/utils';
import { getRequestFormatLocale } from '@/lib/i18n/format-locale.server';

interface ProductQuickFactsProduct {
  createdAt: Date;
  updatedAt: Date;
  deposit: string | null;
  taxSettings: ProductTaxSettings | null;
  bookingAttributeAxes: BookingAttributeAxis[] | null;
}

interface ProductQuickFactsProps {
  product: ProductQuickFactsProduct;
  currency: string;
}

export async function ProductQuickFacts({
  product,
  currency,
}: ProductQuickFactsProps) {
  const t = await getTranslations('dashboard.products.detail.quickFacts');
  const { intl: formatLocale } = await getRequestFormatLocale();

  const depositAmount = product.deposit ? parseFloat(product.deposit) : 0;
  const taxLabel = product.taxSettings?.inheritFromStore
    ? t('taxInherited')
    : product.taxSettings?.customRate != null
      ? t('taxCustomRate', { rate: product.taxSettings.customRate })
      : t('taxInherited');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="h-4 w-4" />
          {t('title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="shrink-0 text-muted-foreground">{t('createdAt')}</span>
          <span className="min-w-0 text-right">{formatDate(product.createdAt, undefined, formatLocale)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="shrink-0 text-muted-foreground">{t('updatedAt')}</span>
          <span className="min-w-0 text-right">{formatDate(product.updatedAt, undefined, formatLocale)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="shrink-0 text-muted-foreground">{t('deposit')}</span>
          <span className="min-w-0 text-right">
            {depositAmount > 0
              ? formatCurrency(depositAmount, currency, formatLocale)
              : t('noDeposit')}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="shrink-0 text-muted-foreground">{t('tax')}</span>
          <span className="min-w-0 text-right">{taxLabel}</span>
        </div>
        {product.bookingAttributeAxes &&
          product.bookingAttributeAxes.length > 0 && (
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0 text-muted-foreground">
                {t('bookingAxes')}
              </span>
              <span className="min-w-0 text-right">
                {product.bookingAttributeAxes
                  .map((axis) => axis.label)
                  .join(', ')}
              </span>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
