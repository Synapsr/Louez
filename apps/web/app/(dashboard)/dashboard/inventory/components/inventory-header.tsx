'use client';

import { useTranslations } from 'next-intl';

export const InventoryHeader = () => {
  const t = useTranslations('dashboard.inventory');

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          {t('description')}
        </p>
      </div>
    </div>
  );
};
