'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { differenceInDays, differenceInHours, differenceInWeeks } from 'date-fns'
import { Plus, Minus, ShoppingCart } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/utils'
import { useCart, type CartItem } from '@/contexts/cart-context'
import { useStoreCurrency } from '@/contexts/store-context'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { RentalDatePicker, QuickDateButtons } from '@/components/storefront/rental-date-picker'
import { AccessoriesModal } from '@/components/storefront/accessories-modal'
import { calculateRentalPrice, type ProductPricing, type PricingTier } from '@/lib/pricing'
import { getMinStartDate } from '@/lib/utils/duration'
import type { PricingMode } from '@/types'

interface Accessory {
  id: string
  name: string
  price: string
  deposit: string
  images: string[] | null
  quantity: number
  pricingMode: PricingMode | null
  pricingTiers?: {
    id: string
    minDuration: number
    discountPercent: string
  }[]
}

interface AddToCartFormProps {
  productId: string
  productName: string
  productImage: string | null
  price: number
  deposit: number
  maxQuantity: number
  pricingMode: 'day' | 'hour' | 'week'
  storePricingMode: 'day' | 'hour' | 'week'
  storeSlug: string
  pricingTiers?: { id: string; minDuration: number; discountPercent: number }[]
  productPricingMode?: PricingMode | null
  advanceNotice?: number
  accessories?: Accessory[]
}

export function AddToCartForm({
  productId,
  productName,
  productImage,
  price,
  deposit,
  maxQuantity,
  pricingMode,
  storePricingMode,
  storeSlug,
  pricingTiers,
  productPricingMode,
  advanceNotice = 0,
  accessories = [],
}: AddToCartFormProps) {
  const router = useRouter()
  const t = useTranslations('storefront.product')
  const currency = useStoreCurrency()
  const { addItem } = useCart()
  const { getUrl } = useStorefrontUrl(storeSlug)
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [quantity, setQuantity] = useState(1)
  const [accessoriesModalOpen, setAccessoriesModalOpen] = useState(false)

  const calculateDuration = () => {
    if (!startDate || !endDate) return 0

    switch (pricingMode) {
      case 'hour':
        return Math.max(1, differenceInHours(endDate, startDate))
      case 'week':
        return Math.max(1, differenceInWeeks(endDate, startDate))
      default:
        return Math.max(1, differenceInDays(endDate, startDate))
    }
  }

  const duration = calculateDuration()

  // Calculate pricing with tiers
  const pricing: ProductPricing = {
    basePrice: price,
    deposit,
    pricingMode,
    tiers: pricingTiers?.map((tier, index) => ({
      ...tier,
      displayOrder: index,
    })) || [],
  }
  const priceResult = calculateRentalPrice(pricing, duration, quantity)
  const subtotal = priceResult.subtotal
  const originalSubtotal = priceResult.originalSubtotal
  const savings = priceResult.savings
  const discountPercent = priceResult.discountPercent
  const totalDeposit = deposit * quantity

  // Filter accessories to only show available ones (in stock and active status is already filtered server-side)
  const availableAccessories = accessories.filter((acc) => acc.quantity > 0)

  const handleAddToCart = () => {
    if (!startDate || !endDate) {
      toast.error(t('selectDates'))
      return
    }

    addItem(
      {
        productId,
        productName,
        productImage,
        price,
        deposit,
        quantity,
        maxQuantity,
        pricingMode: storePricingMode,
        pricingTiers: pricingTiers?.map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration,
          discountPercent: tier.discountPercent,
        })),
        productPricingMode,
      },
      storeSlug
    )

    // If there are available accessories, show the modal
    if (availableAccessories.length > 0) {
      setAccessoriesModalOpen(true)
    } else {
      // Otherwise show the classic toast
      toast.success(t('addedToCart', { name: productName }), {
        action: {
          label: t('goToCheckout'),
          onClick: () => router.push(getUrl('/checkout')),
        },
      })
    }
  }

  const handleQuickDateSelect = (start: Date, end: Date) => {
    setStartDate(start)
    setEndDate(end)
  }

  return (
    <div className="space-y-5">
      {/* Quick Date Selection */}
      <div className="space-y-2">
        <Label className="text-sm text-muted-foreground">{t('quickSelect')}</Label>
        <QuickDateButtons
          onSelect={handleQuickDateSelect}
          pricingMode={pricingMode}
        />
      </div>

      {/* Date Selection */}
      <RentalDatePicker
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={(date) => {
          setEndDate(date)
          // Clear end date if it's before start date
          if (date && startDate && date < startDate) {
            setEndDate(undefined)
          }
        }}
        pricingMode={pricingMode}
        minDate={getMinStartDate(advanceNotice)}
        translations={{
          startDate: t('startDate'),
          endDate: t('endDate'),
          select: t('select'),
          selectTime: t('selectTime'),
        }}
      />

      {/* Quantity */}
      <div className="space-y-2">
        <Label>{t('quantity')}</Label>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            disabled={quantity <= 1}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="text-lg font-medium w-12 text-center">{quantity}</span>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setQuantity(Math.min(maxQuantity, quantity + 1))}
            disabled={quantity >= maxQuantity}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            ({t('availableCount', { count: maxQuantity })})
          </span>
        </div>
      </div>

      {/* Price Summary */}
      {startDate && endDate && duration > 0 && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span>
              {formatCurrency(price, currency)} x {quantity} x {duration}{' '}
              {duration > 1
                ? t(`pricingUnit.${pricingMode}.plural`)
                : t(`pricingUnit.${pricingMode}.singular`)}
            </span>
            {savings > 0 ? (
              <span className="line-through text-muted-foreground">{formatCurrency(originalSubtotal, currency)}</span>
            ) : (
              <span>{formatCurrency(subtotal, currency)}</span>
            )}
          </div>
          {savings > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span className="flex items-center gap-2">
                {t('tieredPricing.discountApplied')}
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                  -{discountPercent}%
                </Badge>
              </span>
              <span>{formatCurrency(subtotal, currency)}</span>
            </div>
          )}
          {totalDeposit > 0 && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{t('deposit')}</span>
              <span>{formatCurrency(totalDeposit, currency)}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-semibold">
            <span>{t('total')}</span>
            <span>{formatCurrency(subtotal + totalDeposit, currency)}</span>
          </div>
          {savings > 0 && (
            <div className="text-xs text-green-600 text-center pt-1">
              {t('tieredPricing.youSave', { amount: formatCurrency(savings, currency) })}
            </div>
          )}
        </div>
      )}

      {/* Add to Cart Button */}
      <Button
        size="lg"
        className="w-full"
        onClick={handleAddToCart}
        disabled={!startDate || !endDate}
      >
        <ShoppingCart className="mr-2 h-5 w-5" />
        {t('addToCart')}
      </Button>

      {/* Accessories Modal */}
      <AccessoriesModal
        open={accessoriesModalOpen}
        onOpenChange={setAccessoriesModalOpen}
        productName={productName}
        accessories={availableAccessories}
        storeSlug={storeSlug}
        storePricingMode={storePricingMode}
        currency={currency}
      />
    </div>
  )
}
