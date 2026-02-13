'use client';

import Link from 'next/link';

import { ShoppingCart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';

import { useStorefrontUrl } from '@/hooks/use-storefront-url';

interface CheckoutEmptyCartStateProps {
  storeSlug: string;
}

export function CheckoutEmptyCartState({
  storeSlug,
}: CheckoutEmptyCartStateProps) {
  const t = useTranslations('storefront.checkout');
  const tCart = useTranslations('storefront.cart');
  const { getUrl } = useStorefrontUrl(storeSlug);

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <ShoppingCart className="text-muted-foreground mb-4 h-16 w-16" />
      <h2 className="mb-2 text-xl font-semibold">{t('emptyCart')}</h2>
      <p className="text-muted-foreground mb-6">{t('emptyCartDescription')}</p>
      <Button render={<Link href={getUrl('/catalog')} />}>
        {tCart('viewCatalog')}
      </Button>
    </div>
  );
}

