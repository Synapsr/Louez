'use client';

import Link from 'next/link';

import { Package, Search, Warehouse } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';

interface InventoryEmptyStateProps {
  variant: 'no-products' | 'tracked-empty' | 'no-results';
}

const EMPTY_ICON = {
  'no-products': Package,
  'tracked-empty': Warehouse,
  'no-results': Search,
} satisfies Record<InventoryEmptyStateProps['variant'], typeof Package>;

export const InventoryEmptyState = ({ variant }: InventoryEmptyStateProps) => {
  const t = useTranslations('dashboard.inventory.empty');
  const Icon = EMPTY_ICON[variant];

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-12 text-center">
      <Icon className="text-muted-foreground h-12 w-12" />
      <h3 className="mt-4 text-lg font-semibold">{t(`${variant}.title`)}</h3>
      <p className="text-muted-foreground mt-2 max-w-xl text-sm">
        {t(`${variant}.description`)}
      </p>
      {variant === 'no-products' ? (
        <Button
          render={<Link href="/dashboard/products/new" />}
          className="mt-4"
        >
          {t('addProduct')}
        </Button>
      ) : null}
      {variant === 'tracked-empty' ? (
        <Button
          variant="outline"
          render={<Link href="/dashboard/products" />}
          className="mt-4"
        >
          {t('chooseProduct')}
        </Button>
      ) : null}
    </div>
  );
};
