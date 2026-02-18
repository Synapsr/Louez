'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Check, ChevronLeft, ChevronRight, ShoppingCart } from 'lucide-react'
import { toastManager } from '@louez/ui'

import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import { formatCurrency } from '@louez/utils'
import { cn } from '@louez/utils'
import { useCart } from '@/contexts/cart-context'
import type { PricingMode } from '@louez/types'

interface Accessory {
  id: string
  name: string
  price: string
  deposit: string
  images: string[] | null
  quantity: number
  pricingMode: PricingMode | null
  basePeriodMinutes?: number | null
  pricingTiers?: {
    id: string
    minDuration: number | null
    discountPercent: string | null
    period?: number | null
    price?: string | null
  }[]
}

interface AccessoriesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  productName: string
  accessories: Accessory[]
  storeSlug: string
  currency?: string
}

export function AccessoriesModal({
  open,
  onOpenChange,
  productName,
  accessories,
  storeSlug,
  currency = 'EUR',
}: AccessoriesModalProps) {
  const t = useTranslations('storefront.accessories')
  const { addItem, items: cartItems } = useCart()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)
  const carouselRef = useRef<HTMLDivElement>(null)

  // Filter out accessories that are already in the cart
  const cartProductIds = new Set(cartItems.map((item) => item.productId))
  const availableAccessories = accessories.filter((acc) => !cartProductIds.has(acc.id))

  const toggleAccessory = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const scroll = useCallback((direction: 'left' | 'right') => {
    if (!carouselRef.current) return
    const scrollAmount = 280 // card width + gap
    carouselRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }, [])

  const handleContinue = () => {
    onOpenChange(false)
    setSelectedIds(new Set())
  }

  const handleAddToCart = async () => {
    setIsAdding(true)

    // Add selected accessories to cart
    const addedNames: string[] = []
    for (const accessory of availableAccessories) {
      if (selectedIds.has(accessory.id)) {
        const effectivePricingMode: PricingMode = accessory.pricingMode ?? 'day'
        addItem(
          {
            productId: accessory.id,
            productName: accessory.name,
            productImage: accessory.images?.[0] || null,
            price: parseFloat(accessory.price),
            deposit: parseFloat(accessory.deposit),
            quantity: 1,
            maxQuantity: accessory.quantity,
            pricingMode: effectivePricingMode,
            basePeriodMinutes: accessory.basePeriodMinutes ?? null,
            pricingTiers: accessory.pricingTiers?.map((tier) => ({
              id: tier.id,
              minDuration: tier.minDuration ?? 1,
              discountPercent: parseFloat(tier.discountPercent ?? '0'),
              period: tier.period ?? null,
              price:
                typeof tier.price === 'string'
                  ? parseFloat(tier.price)
                  : (tier.price ?? null),
            })),
            productPricingMode: accessory.pricingMode,
          },
          storeSlug
        )
        addedNames.push(accessory.name)
      }
    }

    setIsAdding(false)
    onOpenChange(false)
    setSelectedIds(new Set())

    // Show success toast
    if (addedNames.length > 0) {
      toastManager.add({ title: t('accessoriesAdded', { count: addedNames.length }), type: 'success' })
    }
  }

  const selectedCount = selectedIds.size

  // Don't render if no accessories available (after filtering cart items)
  if (availableAccessories.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0">
        {/* Header - fixed */}
        <DialogHeader className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <DialogTitle className="text-lg">{t('productAdded')}</DialogTitle>
              <DialogDescription className="text-sm">
                {productName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content - scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6">
          <div className="pb-2">
            <h3 className="font-semibold text-base">{t('youMightAlsoLike')}</h3>
            <p className="text-sm text-muted-foreground">{t('selectAccessories')}</p>
          </div>

          {/* Carousel */}
          <div className="relative">
            {/* Navigation buttons */}
            {availableAccessories.length > 2 && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-md"
                  onClick={() => scroll('left')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-md"
                  onClick={() => scroll('right')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}

            {/* Carousel container */}
            <div
              ref={carouselRef}
              className="flex gap-3 overflow-x-auto py-4 snap-x snap-mandatory scrollbar-hide"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {availableAccessories.map((accessory) => {
                const isSelected = selectedIds.has(accessory.id)
                const effectivePricingMode: PricingMode = accessory.pricingMode ?? 'day'

                return (
                  <button
                    key={accessory.id}
                    type="button"
                    onClick={() => toggleAccessory(accessory.id)}
                    className={cn(
                      'flex-shrink-0 w-48 snap-start rounded-xl border-2 overflow-hidden transition-all duration-200',
                      'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-md'
                        : 'border-border hover:border-primary/50 hover:shadow-sm'
                    )}
                  >
                    {/* Image */}
                    <div className="relative aspect-square bg-muted">
                      {accessory.images && accessory.images[0] ? (
                        <img
                          src={accessory.images[0]}
                          alt={accessory.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ShoppingCart className="h-6 w-6" />
                        </div>
                      )}

                      {/* Selection indicator */}
                      <div
                        className={cn(
                          'absolute top-2 right-2 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all',
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-background/80 border-muted-foreground/30'
                        )}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5" />}
                      </div>

                      {/* Stock badge */}
                      <Badge
                        variant="secondary"
                        className="absolute bottom-2 left-2 text-[10px] px-1.5 py-0.5"
                      >
                        {t('available', { count: accessory.quantity })}
                      </Badge>
                    </div>

                    {/* Content */}
                    <div className="p-2.5 text-left">
                      <h4 className="font-medium text-sm line-clamp-1">{accessory.name}</h4>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="text-sm font-bold">
                          {formatCurrency(parseFloat(accessory.price), currency)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          /{t(`pricingUnit.${effectivePricingMode}`)}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Actions - fixed footer */}
        <div className="flex-shrink-0 flex flex-col-reverse sm:flex-row gap-3 p-6 pt-4 border-t bg-muted/30">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleContinue}
          >
            {t('continueWithout')}
          </Button>
          <Button
            className="flex-1"
            onClick={handleAddToCart}
            disabled={selectedCount === 0 || isAdding}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            {t('addToCart', { count: selectedCount })}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  )
}
