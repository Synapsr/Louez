'use client'

import { TrendingDownSolidIcon } from '@louez/ui/icons'
import Link from 'next/link'
import { Calendar } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Card, CardContent } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Button } from '@louez/ui'
import { formatCurrency, minutesToPriceDuration } from '@louez/utils'
import { ProductImage } from '@/components/product/product-image'
import { useStoreCurrency, useStoreMaxDiscountPercent } from '@/contexts/store-context'
import type { PricingKind, PricingMode, StockKind } from '@louez/types'
import { getStorefrontPricingSummary } from '@/lib/utils/storefront-pricing'

interface PricingTier {
  id: string
  minDuration: number | null
  discountPercent: string | null
  period?: number | null
  price?: string | null
  displayOrder: number | null
}

interface ProductCardProps {
  product: {
    id: string
    name: string
    price: string
    images: string[] | null
    quantity: number
    stockKind?: StockKind | null
    pricingKind?: PricingKind | null
    pricingMode?: PricingMode | null
    basePeriodMinutes?: number | null
    pricingTiers?: PricingTier[]
  }
  storeSlug: string
  /** Prefix product links need on this host (empty on a store subdomain). */
  basePath?: string
}

export function ProductCard({ product, basePath = '' }: ProductCardProps) {
  const t = useTranslations('storefront.product')
  const tCatalog = useTranslations('storefront.catalog')
  const tCommon = useTranslations('common')
  const currency = useStoreCurrency()
  const maxDiscountPercent = useStoreMaxDiscountPercent()
  const mainImage = product.images?.[0]
  const isAvailable = product.quantity > 0
  // A consumable at zero is a restock away, not a scheduling conflict — say so.
  const unavailableLabel =
    product.stockKind === 'consumable'
      ? tCatalog('consumableOutOfStock')
      : tCatalog('unavailable')

  const pricingSummary = getStorefrontPricingSummary(product)
  // Show the max discount that's within the store limit, or the absolute max if no limit
  const cardDiscount = maxDiscountPercent == null
    ? pricingSummary.maxReductionPercent
    : Math.max(...pricingSummary.allReductionPercents.filter((p) => p <= maxDiscountPercent), 0)
  // A forfait prices the whole booking — there is no period to suffix.
  const displayPeriod =
    pricingSummary.displayPeriodMinutes == null
      ? null
      : minutesToPriceDuration(pricingSummary.displayPeriodMinutes)
  const periodLabel = !displayPeriod
    ? null
    : displayPeriod.unit === 'minute'
      ? displayPeriod.duration === 1
        ? tCommon('minuteUnit', { count: 1 })
        : `${displayPeriod.duration} ${tCommon('minuteUnit', { count: displayPeriod.duration })}`
      : displayPeriod.duration === 1
        ? t(`pricingUnit.${displayPeriod.unit}.singular`)
        : `${displayPeriod.duration} ${t(`pricingUnit.${displayPeriod.unit}.plural`)}`

  return (
    <Link href={`${basePath}/product/${product.id}`} className="group block">
      <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border border-border/50 hover:border-primary/20 bg-card p-0 gap-0">
        {/* Image container - square aspect ratio */}
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          <ProductImage
            src={mainImage}
            alt={product.name}
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
            inset={false}
            className="transition-transform duration-500 group-hover:scale-105"
            containerClassName="absolute inset-0 rounded-none"
          />

          {/* Availability badge */}
          {!isAvailable && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-sm">
              <Badge variant="failed" className="text-sm px-4 py-1.5">
                {unavailableLabel}
              </Badge>
            </div>
          )}

          {/* Quick action button - shows on hover */}
          {isAvailable && (
            <div className="absolute bottom-3 left-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
              {/* Rendered as a span: this card is already a link, and a button
                  inside an anchor is invalid markup. */}
              <Button className="w-full shadow-lg" render={<span />}>
                <Calendar className="mr-2 h-4 w-4" />
                {t('viewDetails')}
              </Button>
            </div>
          )}

          {/* Pricing tiers badge */}
          {isAvailable && cardDiscount > 0 && product.quantity > 2 && (
            <Badge variant="progress" className="absolute top-3 left-3 text-xs font-medium">
              <TrendingDownSolidIcon className="h-3 w-3 mr-1" />-{Math.floor(cardDiscount)}%
            </Badge>
          )}
        </div>

        {/* Content */}
        <CardContent className="p-4">
          <h3 className="font-medium text-sm md:text-base line-clamp-2 min-h-[2.5rem] group-hover:text-primary transition-colors">
            {product.name}
          </h3>

          <div className="mt-2 flex items-baseline gap-1">
            {pricingSummary.showStartingFrom && (
              <span className="text-xs md:text-sm text-muted-foreground">
                {t('startingFrom')}
              </span>
            )}
            <span className="text-lg md:text-xl font-bold text-primary">
              {formatCurrency(pricingSummary.displayPrice, currency)}
            </span>
            <span className="text-xs md:text-sm text-muted-foreground">
              {periodLabel ? `/ ${periodLabel}` : t('fixedPricingLabel')}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
