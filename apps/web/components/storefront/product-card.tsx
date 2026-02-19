'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ImageIcon, Calendar, TrendingDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Card, CardContent } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Button } from '@louez/ui'
import { formatCurrency, minutesToPriceDuration } from '@louez/utils'
import { useStoreCurrency } from '@/contexts/store-context'
import type { PricingMode } from '@louez/types'
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
    pricingMode?: PricingMode | null
    basePeriodMinutes?: number | null
    pricingTiers?: PricingTier[]
  }
  storeSlug: string
}

export function ProductCard({ product }: ProductCardProps) {
  const t = useTranslations('storefront.product')
  const tCatalog = useTranslations('storefront.catalog')
  const tCommon = useTranslations('common')
  const currency = useStoreCurrency()
  const mainImage = product.images?.[0]
  const isAvailable = product.quantity > 0

  const pricingSummary = getStorefrontPricingSummary(product)
  const displayPeriod = minutesToPriceDuration(pricingSummary.displayPeriodMinutes)
  const periodLabel =
    displayPeriod.unit === 'minute'
      ? displayPeriod.duration === 1
        ? tCommon('minuteUnit', { count: 1 })
        : `${displayPeriod.duration} ${tCommon('minuteUnit', { count: displayPeriod.duration })}`
      : displayPeriod.duration === 1
        ? t(`pricingUnit.${displayPeriod.unit}.singular`)
        : `${displayPeriod.duration} ${t(`pricingUnit.${displayPeriod.unit}.plural`)}`

  return (
    <Link href="/#date-picker" className="group block">
      <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border border-border/50 hover:border-primary/20 bg-card p-0 gap-0">
        {/* Image container - square aspect ratio */}
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          {mainImage ? (
            <Image
              src={mainImage}
              alt={product.name}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}

          {/* Availability badge */}
          {!isAvailable && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-sm">
              <Badge variant="secondary" className="text-sm px-4 py-1.5">
                {tCatalog('unavailable')}
              </Badge>
            </div>
          )}

          {/* Quick action button - shows on hover */}
          {isAvailable && (
            <div className="absolute bottom-3 left-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
              <Button className="w-full shadow-lg">
                <Calendar className="mr-2 h-4 w-4" />
                {t('selectDates')}
              </Button>
            </div>
          )}

          {/* Pricing tiers badge */}
          {isAvailable && pricingSummary.maxReductionPercent > 0 && product.quantity > 2 && (
            <Badge
              variant="secondary"
              className="absolute top-3 left-3 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/70 dark:text-green-300"
            >
              <TrendingDown className="h-3 w-3 mr-1" />
              -{Math.floor(pricingSummary.maxReductionPercent)}%
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
              / {periodLabel}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
