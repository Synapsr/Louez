import { useCallback, useMemo } from 'react'

import { findApplicableTier } from '@louez/utils'
import { getDetailedDuration } from '@/lib/utils/duration'

import type { PricingMode, PricingTier } from '@louez/types'

import type {
  CustomItem,
  Product,
  ProductPricingDetails,
  SelectedProduct,
} from '../types'

interface UseNewReservationPricingParams {
  startDate: Date | undefined
  endDate: Date | undefined
  selectedProducts: SelectedProduct[]
  customItems: CustomItem[]
  products: Product[]
}

export function useNewReservationPricing({
  startDate,
  endDate,
  selectedProducts,
  customItems,
  products,
}: UseNewReservationPricingParams) {
  const calculateDurationForMode = useCallback(
    (reservationStartDate: Date, reservationEndDate: Date, mode: PricingMode): number => {
      const diffMs = reservationEndDate.getTime() - reservationStartDate.getTime()
      if (mode === 'hour') {
        return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)))
      }
      if (mode === 'week') {
        return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)))
      }
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)))
    },
    []
  )

  const duration = useMemo(() => {
    if (!startDate || !endDate) {
      return 0
    }

    return calculateDurationForMode(startDate, endDate, 'day')
  }, [calculateDurationForMode, endDate, startDate])

  const detailedDuration = useMemo(() => {
    if (!startDate || !endDate) {
      return null
    }

    return getDetailedDuration(startDate, endDate)
  }, [endDate, startDate])

  const hasItems = selectedProducts.length > 0 || customItems.length > 0

  const getProductPricingDetails = useCallback(
    (product: Product, selectedItem?: SelectedProduct): ProductPricingDetails => {
      const productPricingMode = (product.pricingMode ?? 'day') as PricingMode
      const productDuration =
        startDate && endDate
          ? calculateDurationForMode(startDate, endDate, productPricingMode)
          : 0

      const basePrice = parseFloat(product.price)
      const productTiers: PricingTier[] = product.pricingTiers.map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration,
        discountPercent: parseFloat(tier.discountPercent),
        displayOrder: tier.displayOrder || 0,
      }))

      const applicableTier =
        productDuration > 0 ? findApplicableTier(productTiers, productDuration) : null
      const calculatedPrice = applicableTier
        ? basePrice * (1 - applicableTier.discountPercent / 100)
        : basePrice

      const hasPriceOverride = Boolean(selectedItem?.priceOverride)
      const effectivePrice = hasPriceOverride
        ? selectedItem?.priceOverride?.unitPrice ?? calculatedPrice
        : calculatedPrice

      return {
        productPricingMode,
        productDuration,
        basePrice,
        calculatedPrice,
        effectivePrice,
        hasPriceOverride,
        hasDiscount: Boolean(applicableTier && applicableTier.discountPercent > 0),
        applicableTierDiscountPercent: applicableTier?.discountPercent ?? null,
        hasTieredPricing: productTiers.length > 0,
      }
    },
    [calculateDurationForMode, endDate, startDate]
  )

  const getCustomItemTotal = useCallback(
    (item: CustomItem) => {
      if (!startDate || !endDate) {
        return 0
      }

      return item.unitPrice * item.quantity * calculateDurationForMode(startDate, endDate, item.pricingMode)
    },
    [calculateDurationForMode, endDate, startDate]
  )

  const { subtotal, originalSubtotal, deposit, totalSavings } = useMemo(() => {
    if (!startDate || !endDate || !hasItems || duration === 0) {
      return { subtotal: 0, originalSubtotal: 0, deposit: 0, totalSavings: 0 }
    }

    let subtotalAmount = 0
    let originalAmount = 0
    let depositAmount = 0

    for (const item of selectedProducts) {
      const product = products.find((p) => p.id === item.productId)
      if (!product) continue

      const productDeposit = parseFloat(product.deposit || '0')
      const pricing = getProductPricingDetails(product, item)

      originalAmount += pricing.basePrice * pricing.productDuration * item.quantity
      subtotalAmount += pricing.effectivePrice * pricing.productDuration * item.quantity
      depositAmount += productDeposit * item.quantity
    }

    for (const item of customItems) {
      const itemDuration = calculateDurationForMode(startDate, endDate, item.pricingMode)
      const itemTotal = item.unitPrice * itemDuration * item.quantity
      subtotalAmount += itemTotal
      originalAmount += itemTotal
      depositAmount += item.deposit * item.quantity
    }

    return {
      subtotal: subtotalAmount,
      originalSubtotal: originalAmount,
      deposit: depositAmount,
      totalSavings: originalAmount - subtotalAmount,
    }
  }, [
    calculateDurationForMode,
    customItems,
    duration,
    endDate,
    getProductPricingDetails,
    hasItems,
    products,
    selectedProducts,
    startDate,
  ])

  return {
    calculateDurationForMode,
    duration,
    detailedDuration,
    hasItems,
    subtotal,
    originalSubtotal,
    deposit,
    totalSavings,
    getProductPricingDetails,
    getCustomItemTotal,
  }
}
