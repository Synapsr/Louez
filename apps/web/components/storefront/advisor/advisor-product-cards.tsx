'use client';

import Image from 'next/image';
import Link from 'next/link';

import { ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatCurrency } from '@louez/utils';

import { useStore } from '@/contexts/store-context';
import { useStorefrontUrl } from '@/hooks/use-storefront-url';

export type AdvisorRecommendedProduct = {
  id: string;
  name: string;
  price: string;
  pricingMode: 'hour' | 'day' | 'week' | null;
  image: string | null;
};

type AdvisorProductCardsProps = {
  products: AdvisorRecommendedProduct[];
};

/** Renders a recommend_products tool result as tappable product cards. */
export const AdvisorProductCards = ({
  products,
}: AdvisorProductCardsProps) => {
  const t = useTranslations('storefront.product');
  const { currency, storeSlug } = useStore();
  const { getUrl } = useStorefrontUrl(storeSlug);

  if (products.length === 0) return null;

  return (
    <div className="my-2 flex flex-col gap-2">
      {products.map((product) => (
        <Link
          key={product.id}
          href={getUrl(`/product/${product.id}`)}
          className="group flex items-center gap-3 rounded-xl border border-border/60 bg-background p-2.5 transition-colors hover:border-primary/40"
        >
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
            {product.image ? (
              <Image
                src={product.image}
                alt={product.name}
                fill
                sizes="56px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
              {product.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(Number(product.price), currency)}
              {product.pricingMode
                ? ` / ${t(`pricingUnit.${product.pricingMode}.singular`)}`
                : null}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
};
