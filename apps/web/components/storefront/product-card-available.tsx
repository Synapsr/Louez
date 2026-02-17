'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Plus, ImageIcon, Minus, Check, TrendingDown } from 'lucide-react'
import { toastManager } from '@louez/ui'
import type { Rate } from '@louez/types'

import { Button } from '@louez/ui'
import { Card, CardContent } from '@louez/ui'
import { Badge } from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'
import { useCart } from '@/contexts/cart-context'
import { useStoreCurrency } from '@/contexts/store-context'
import { AvailabilityBadge, type AvailabilityStatus } from './availability-badge'
import { ProductModal } from './product-modal'
import { AccessoriesModal } from './accessories-modal'
import {
  calculateRentalPrice,
  calculateRentalPriceV2,
  calculateDurationMinutes,
  isRateBasedProduct,
  type ProductPricing,
} from '@louez/utils'
import type { PricingMode } from '@louez/utils'
import type { CombinationAvailability } from '@louez/types'

interface PricingTier {
  id: string
  minDuration: number | null
  discountPercent: string | number | null
  period?: number | null
  price?: string | null
}

interface Accessory {
  id: string
  name: string
  price: string
  deposit: string
  images: string[] | null
  quantity: number
  pricingMode: PricingMode | null
  basePeriodMinutes?: number | null
  pricingTiers?: PricingTier[]
}

interface ProductCardAvailableProps {
  product: {
    id: string
    name: string
    description: string | null
    images: string[] | null
    price: string
    deposit: string | null
    quantity: number
    category?: { name: string } | null
    pricingMode?: PricingMode | null
    basePeriodMinutes?: number | null
    pricingTiers?: PricingTier[]
    videoUrl?: string | null
    accessories?: Accessory[]
    trackUnits?: boolean | null
    bookingAttributeAxes?: Array<{ key: string; label: string; position: number }> | null
    units?: Array<{
      status: 'available' | 'maintenance' | 'retired' | null
      attributes: Record<string, string> | null
    }>
  }
  storeSlug: string
  availableQuantity: number
  startDate: string
  endDate: string
  duration: number
  availableCombinations?: CombinationAvailability[]
}

// Helper to convert tier discountPercent to number
function normalizeTiers(tiers?: PricingTier[]): { id: string; minDuration: number; discountPercent: number; displayOrder: number }[] {
  if (!tiers) return []
  return tiers.map((tier, index) => ({
    id: tier.id,
    minDuration: tier.minDuration ?? 1,
    discountPercent: typeof tier.discountPercent === 'string'
      ? parseFloat(tier.discountPercent ?? '0')
      : (tier.discountPercent ?? 0),
    displayOrder: index,
  }))
}

export function ProductCardAvailable({
  product,
  storeSlug,
  availableQuantity,
  startDate,
  endDate,
  duration,
  availableCombinations = [],
}: ProductCardAvailableProps) {
  const t = useTranslations('storefront.product')
  const currency = useStoreCurrency()
  const {
    addItem,
    getCartLinesByProductId,
    getProductQuantityInCart,
    updateItemQuantityByLineId,
  } = useCart()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [accessoriesModalOpen, setAccessoriesModalOpen] = useState(false)

  const cartLines = getCartLinesByProductId(product.id)
  const firstLine = cartLines[0]
  const cartQuantity = getProductQuantityInCart(product.id)
  const inCart = cartQuantity > 0

  const price = parseFloat(product.price)
  const deposit = product.deposit ? parseFloat(product.deposit) : 0
  const mainImage = product.images?.[0]

  const effectivePricingMode: PricingMode = product.pricingMode ?? 'day'
  const normalizedTiers = normalizeTiers(product.pricingTiers)
  const durationMinutes = calculateDurationMinutes(startDate, endDate)
  const rateTiers: Rate[] = (product.pricingTiers || [])
    .filter(
      (tier): tier is PricingTier & { period: number; price: string | number } =>
        typeof tier.period === 'number' &&
        tier.period > 0 &&
        (typeof tier.price === 'string' || typeof tier.price === 'number'),
    )
    .map((tier, index) => ({
      id: tier.id,
      period: tier.period,
      price: typeof tier.price === 'string' ? parseFloat(tier.price) : tier.price,
      displayOrder: index,
    }))

  const isRateBased = isRateBasedProduct({
    basePeriodMinutes: product.basePeriodMinutes,
  })

  const priceResult = isRateBased
    ? calculateRentalPriceV2(
        {
          basePrice: price,
          basePeriodMinutes: product.basePeriodMinutes!,
          deposit,
          rates: rateTiers,
        },
        durationMinutes,
        1,
      )
    : calculateRentalPrice(
        {
          basePrice: price,
          deposit,
          pricingMode: effectivePricingMode,
          tiers: normalizedTiers,
        } as ProductPricing,
        duration,
        1,
      )

  const totalPrice = priceResult.subtotal
  const originalPrice = priceResult.originalSubtotal
  const hasDiscount = priceResult.savings > 0
  const discountPercent =
    'reductionPercent' in priceResult
      ? priceResult.reductionPercent
      : priceResult.discountPercent

  const status: AvailabilityStatus = inCart
    ? 'in_cart'
    : availableQuantity === 0
      ? 'unavailable'
      : availableQuantity < product.quantity
        ? 'limited'
        : 'available'

  const maxQuantity = Math.min(availableQuantity, product.quantity)
  const firstLineQuantity = firstLine?.quantity || 0
  const firstLineMaxQuantity = firstLine?.maxQuantity || maxQuantity
  const canAddMore = firstLineQuantity < firstLineMaxQuantity
  const hasBookingAttributes = (product.bookingAttributeAxes?.length || 0) > 0

  // Filter available accessories (active with stock)
  const availableAccessories = (product.accessories || []).filter((acc) => acc.quantity > 0)

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (status === 'unavailable') return
    if (hasBookingAttributes) {
      setIsModalOpen(true)
      return
    }

    if (inCart) {
      if (firstLine && canAddMore) {
        updateItemQuantityByLineId(firstLine.lineId, firstLine.quantity + 1)
        toastManager.add({ title: t('addedToCart', { name: product.name }), type: 'success' })
      }
    } else {
      addItem(
        {
          productId: product.id,
          productName: product.name,
          productImage: mainImage || null,
          price,
          deposit,
          quantity: 1,
          maxQuantity,
          pricingMode: effectivePricingMode,
          basePeriodMinutes: product.basePeriodMinutes ?? null,
          pricingTiers: product.pricingTiers?.map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration ?? 1,
            discountPercent: typeof tier.discountPercent === 'string'
              ? parseFloat(tier.discountPercent ?? '0')
              : (tier.discountPercent ?? 0),
            period: tier.period ?? null,
            price:
              typeof tier.price === 'string'
                ? parseFloat(tier.price)
                : (tier.price ?? null),
          })),
          productPricingMode: product.pricingMode,
        },
        storeSlug
      )

      // Show accessories modal if there are available accessories, otherwise show toast
      if (availableAccessories.length > 0) {
        setAccessoriesModalOpen(true)
      } else {
        toastManager.add({ title: t('addedToCart', { name: product.name }), type: 'success' })
      }
    }
  }

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (firstLine && firstLine.quantity > 0) {
      updateItemQuantityByLineId(firstLine.lineId, firstLine.quantity - 1)
    }
  }

  const handleOpenModal = () => {
    setIsModalOpen(true)
  }

  const isUnavailable = status === 'unavailable'

  return (
    <>
      <Card
        className={cn(
          'group overflow-hidden transition-all duration-200 cursor-pointer p-0 gap-0',
          isUnavailable
            ? 'opacity-50'
            : 'hover:shadow-md hover:border-primary/20'
        )}
        onClick={handleOpenModal}
      >
        {/* Image */}
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          {mainImage ? (
            <Image
              src={mainImage}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 50vw, 33vw"
              className={cn(
                'object-cover transition-transform duration-300',
                !isUnavailable && 'group-hover:scale-105'
              )}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-8 w-8 md:h-12 md:w-12 text-muted-foreground" />
            </div>
          )}

          {/* Badge overlay */}
          <div className="absolute top-1.5 left-1.5 md:top-2 md:left-2">
            <AvailabilityBadge
              status={status}
              availableQuantity={availableQuantity}
              totalQuantity={product.quantity}
              cartQuantity={cartQuantity}
            />
          </div>

          {/* Quick add button - always visible on mobile, hover on desktop */}
          {!isUnavailable && (
            <>
              {/* Mobile: always visible floating button */}
              <div className="absolute bottom-1.5 right-1.5 md:hidden">
                {inCart && !hasBookingAttributes ? (
                  <div className="flex items-center gap-1 bg-background/95 backdrop-blur rounded-full shadow-lg border p-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={handleDecrement}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-5 text-center text-sm font-medium">{cartQuantity}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full"
                      onClick={handleQuickAdd}
                      disabled={!canAddMore}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon"
                    className="h-9 w-9 rounded-full shadow-lg"
                    onClick={hasBookingAttributes ? handleOpenModal : handleQuickAdd}
                  >
                    {hasBookingAttributes && inCart ? (
                      <span className="text-xs font-semibold">{cartQuantity}</span>
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                )}
              </div>

              {/* Desktop: hover overlay */}
              <div className="hidden md:block absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                {inCart && !hasBookingAttributes ? (
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleDecrement}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="text-white font-medium px-3">{cartQuantity}</span>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleQuickAdd}
                      disabled={!canAddMore}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full h-9"
                    onClick={hasBookingAttributes ? handleOpenModal : handleQuickAdd}
                  >
                    {hasBookingAttributes && inCart ? (
                      <>
                        <Check className="h-4 w-4 mr-1" />
                        {cartQuantity}
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-1" />
                        {t('addToCart')}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Content */}
        <CardContent className="p-2.5 md:p-4">
          {/* Name */}
          <h3 className="font-medium text-sm md:text-base line-clamp-2 mb-1 md:mb-2 group-hover:text-primary transition-colors">
            {product.name}
          </h3>

          {/* Total price for the period */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {hasDiscount ? (
                <>
                  <span className="text-base md:text-lg font-bold text-primary">
                    {formatCurrency(totalPrice, currency)}
                  </span>
                  <span className="text-xs text-muted-foreground line-through">
                    {formatCurrency(originalPrice, currency)}
                  </span>
                </>
              ) : (
                <span className="text-base md:text-lg font-bold text-primary">
                  {formatCurrency(totalPrice, currency)}
                </span>
              )}
            </div>

            {/* Discount badge or cart indicator */}
            {hasDiscount && !inCart && (
              <Badge variant="success" className="text-xs shrink-0">
                <TrendingDown className="h-3 w-3 mr-0.5" />
                -{Math.floor(discountPercent!)}%
              </Badge>
            )}
            {inCart && (
              <div className="flex items-center gap-0.5 text-primary">
                <Check className="h-3 w-3" />
                <span className="text-xs font-medium">{cartQuantity}</span>
              </div>
            )}
          </div>

          {/* Duration info */}
          <p className="text-xs text-muted-foreground mt-1">
            {duration} {effectivePricingMode === 'hour'
              ? t('pricingUnit.hour.plural')
              : effectivePricingMode === 'week'
                ? t('pricingUnit.week.plural')
                : t('pricingUnit.day.plural')}
          </p>
        </CardContent>
      </Card>

      {/* Product Modal */}
      <ProductModal
        product={product}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        storeSlug={storeSlug}
        availableQuantity={availableQuantity}
        startDate={startDate}
        endDate={endDate}
        availableCombinations={availableCombinations}
      />

      {/* Accessories Modal */}
      <AccessoriesModal
        open={accessoriesModalOpen}
        onOpenChange={setAccessoriesModalOpen}
        productName={product.name}
        accessories={availableAccessories.map((acc) => ({
          ...acc,
          pricingTiers: acc.pricingTiers?.map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration ?? 1,
            discountPercent: typeof tier.discountPercent === 'string'
              ? (tier.discountPercent ?? '0')
              : (tier.discountPercent ?? 0).toString(),
            period: tier.period ?? null,
            price: tier.price ?? null,
          })),
        }))}
        storeSlug={storeSlug}
        currency={currency}
      />
    </>
  )
}
