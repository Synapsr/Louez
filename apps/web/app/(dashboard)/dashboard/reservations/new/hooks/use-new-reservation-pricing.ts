import { useCallback, useMemo } from 'react'

import {
  calculateDurationMinutes,
  calculateRentalPriceV2,
  findApplicableTier,
  isRateBasedProduct,
} from '@louez/utils'
import { getDetailedDuration } from '@/lib/utils/duration'

import type { PricingMode, PricingTier, Rate } from '@louez/types'

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
      const basePrice = parseFloat(product.price)
      const hasPriceOverride = Boolean(selectedItem?.priceOverride)
      const quantity = selectedItem?.quantity ?? 1
      const rateBased = isRateBasedProduct({ basePeriodMinutes: product.basePeriodMinutes })

      const productDuration =
        startDate && endDate
          ? calculateDurationForMode(startDate, endDate, productPricingMode)
          : 0

      // Rate-based pricing path (basePeriodMinutes > 0)
      if (rateBased && startDate && endDate) {
        const durationMins = calculateDurationMinutes(startDate, endDate)

        const rates: Rate[] = (product.pricingTiers || [])
          .filter(
            (tier): tier is typeof tier & { period: number; price: string } =>
              typeof tier.period === 'number' &&
              tier.period > 0 &&
              typeof tier.price === 'string'
          )
          .map((tier, index) => ({
            id: tier.id,
            price: parseFloat(tier.price),
            period: tier.period,
            displayOrder: tier.displayOrder ?? index,
          }))

        const v2Result = calculateRentalPriceV2(
          {
            basePrice,
            basePeriodMinutes: product.basePeriodMinutes!,
            deposit: parseFloat(product.deposit || '0'),
            rates,
          },
          durationMins,
          quantity,
        )

        // For price override: replace the DP-computed subtotal with manual calculation
        const overrideUnitPrice = selectedItem?.priceOverride?.unitPrice
        const lineSubtotal = hasPriceOverride && overrideUnitPrice != null
          ? overrideUnitPrice * productDuration * quantity
          : v2Result.subtotal

        // calculatedPrice: DP-equivalent per unit per period (for override dialog reference)
        const dpPerUnitPerPeriod = productDuration > 0
          ? v2Result.subtotal / quantity / productDuration
          : basePrice

        return {
          productPricingMode,
          productDuration,
          basePrice,
          calculatedPrice: dpPerUnitPerPeriod,
          effectivePrice: hasPriceOverride && overrideUnitPrice != null
            ? overrideUnitPrice
            : dpPerUnitPerPeriod,
          hasPriceOverride,
          hasDiscount: v2Result.savings > 0,
          applicableTierDiscountPercent: null,
          hasTieredPricing: rates.length > 0,
          isRateBased: true,
          lineSubtotal,
          lineOriginalSubtotal: v2Result.originalSubtotal,
          lineSavings: v2Result.originalSubtotal - lineSubtotal,
          reductionPercent: v2Result.reductionPercent,
        }
      }

      // Progressive/tiered pricing path
      const productTiers: PricingTier[] = product.pricingTiers.map((tier) => ({
        id: tier.id,
        minDuration: tier.minDuration ?? 1,
        discountPercent: parseFloat(tier.discountPercent ?? '0'),
        displayOrder: tier.displayOrder || 0,
      }))

      const applicableTier =
        productDuration > 0 ? findApplicableTier(productTiers, productDuration) : null
      const applicableTierDiscount = applicableTier?.discountPercent ?? 0
      const calculatedPrice = applicableTier
        ? basePrice * (1 - applicableTierDiscount / 100)
        : basePrice

      const effectivePrice = hasPriceOverride
        ? selectedItem?.priceOverride?.unitPrice ?? calculatedPrice
        : calculatedPrice

      const lineSubtotal = effectivePrice * productDuration * quantity
      const lineOriginalSubtotal = basePrice * productDuration * quantity

      return {
        productPricingMode,
        productDuration,
        basePrice,
        calculatedPrice,
        effectivePrice,
        hasPriceOverride,
        hasDiscount: Boolean(applicableTier && applicableTierDiscount > 0),
        applicableTierDiscountPercent: applicableTier?.discountPercent ?? null,
        hasTieredPricing: productTiers.length > 0,
        isRateBased: false,
        lineSubtotal,
        lineOriginalSubtotal,
        lineSavings: lineOriginalSubtotal - lineSubtotal,
        reductionPercent: applicableTier?.discountPercent ?? null,
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

      originalAmount += pricing.lineOriginalSubtotal
      subtotalAmount += pricing.lineSubtotal
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
