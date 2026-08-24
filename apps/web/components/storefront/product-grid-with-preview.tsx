'use client'

import { TrendingDownSolidIcon } from '@louez/ui/icons'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Calendar } from 'lucide-react'

import { Card, CardContent } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Button } from '@louez/ui'
import { formatCurrency, minutesToPriceDuration } from '@louez/utils'
import { useStoreCurrency, useStoreMaxDiscountPercent } from '@/contexts/store-context'
import { ProductImage } from '@/components/product/product-image'
import { ProductPreviewModal } from './product-preview-modal'
import type { PricingKind, PricingMode } from '@louez/types'
import type { BusinessHours } from '@louez/types'
import { getStorefrontPricingSummary } from '@/lib/utils/storefront-pricing'

interface PricingTier {
  id: string
  minDuration: number | null
  discountPercent: string | null
  period?: number | null
  price?: string | null
  displayOrder: number | null
}

interface Product {
  id: string
  name: string
  description: string | null
  price: string
  images: string[] | null
  quantity: number
  deposit: string | null
  pricingKind?: PricingKind | null
  pricingMode?: PricingMode | null
  basePeriodMinutes?: number | null
  pricingTiers?: PricingTier[]
  videoUrl?: string | null
  category?: { name: string } | null
}

interface ProductGridWithPreviewProps {
  products: Product[]
  storeSlug: string
  /** Prefix product links need on this host (empty on a store subdomain). */
  basePath?: string
  businessHours?: BusinessHours
  advanceNotice?: number
  minRentalMinutes?: number
  timezone?: string
  initialProductId?: string
}

function ProductCardInteractive({
  product,
  href,
  onClick,
}: {
  product: Product
  href: string
  onClick: () => void
}) {
  const t = useTranslations('storefront.product')
  const tCatalog = useTranslations('storefront.catalog')
  const tCommon = useTranslations('common')
  const currency = useStoreCurrency()
  const maxDiscountPercent = useStoreMaxDiscountPercent()
  const mainImage = product.images?.[0]
  const isAvailable = product.quantity > 0

  const pricingSummary = getStorefrontPricingSummary(product)
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

  // The card opens the preview drawer, but it stays a real link: crawlers can
  // reach the product page, and cmd/middle-click opens it in a new tab.
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const opensInNewTab =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (opensInNewTab || event.button !== 0 || !isAvailable) return

    event.preventDefault()
    onClick()
  }

  return (
    <Link href={href} onClick={handleClick} className="group block text-left w-full">
      <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 border border-border/50 hover:border-primary/20 bg-card p-0 gap-0">
        {/* Image container */}
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          <ProductImage
            src={mainImage}
            alt={product.name}
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
            inset={false}
            className="transition-transform duration-500 group-hover:scale-105"
            containerClassName="absolute inset-0 rounded-none"
          />

          {/* Unavailable overlay */}
          {!isAvailable && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90 backdrop-blur-sm">
              <Badge variant="failed" className="text-sm px-4 py-1.5">
                {tCatalog('unavailable')}
              </Badge>
            </div>
          )}

          {/* Quick action button */}
          {isAvailable && (
            <div className="absolute bottom-3 left-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
              <Button className="w-full shadow-lg" render={<span />}>
                  <Calendar className="mr-2 h-4 w-4" />
                  {t('selectDates')}
              </Button>
            </div>
          )}

          {/* Discount badge */}
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

export function ProductGridWithPreview({
  products,
  storeSlug,
  basePath = '',
  businessHours,
  advanceNotice,
  minRentalMinutes = 0,
  timezone,
  initialProductId,
}: ProductGridWithPreviewProps) {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const initialOpenDone = useRef(false)

  // Auto-open modal when initialProductId is provided via query param
  useEffect(() => {
    if (initialProductId && !initialOpenDone.current) {
      const product = products.find((p) => p.id === initialProductId)
      if (product) {
        initialOpenDone.current = true
        setSelectedProduct(product)
        setIsModalOpen(true)
        // Clean up the query param from the URL without navigation
        const url = new URL(window.location.href)
        url.searchParams.delete('product')
        window.history.replaceState({}, '', url.toString())
      }
    }
  }, [initialProductId, products])

  const handleProductClick = (product: Product) => {
    setSelectedProduct(product)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedProduct(null)
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {products.map((product) => (
          <ProductCardInteractive
            key={product.id}
            product={product}
            href={`${basePath}/product/${product.id}`}
            onClick={() => handleProductClick(product)}
          />
        ))}
      </div>

      {selectedProduct && (
        <ProductPreviewModal
          product={selectedProduct}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          storeSlug={storeSlug}
          businessHours={businessHours}
          advanceNotice={advanceNotice}
          minRentalMinutes={minRentalMinutes}
          timezone={timezone}
        />
      )}
    </>
  )
}
