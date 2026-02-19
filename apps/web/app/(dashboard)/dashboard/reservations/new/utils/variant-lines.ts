import type { CombinationAvailability } from '@louez/types'

import {
  buildCombinationKey,
  canonicalizeAttributes,
  getDeterministicCombinationSortValue,
  getSelectionCapacity,
  getSelectionMode,
  getTotalAvailableForSelection,
} from '@louez/utils'

import type { Product, SelectedProduct } from '../types'

export interface LineQuantityConstraints {
  lineMaxQuantity: number
  selectionCapacity: number
  selectionMode: 'none' | 'partial' | 'full'
  hasBookingAttributes: boolean
}

function getSortedAxes(product: Product) {
  return (product.bookingAttributeAxes || [])
    .slice()
    .sort((a, b) => a.position - b.position)
}

export function buildProductCombinations(product: Product): CombinationAvailability[] {
  const bookingAttributeAxes = getSortedAxes(product)
  const byCombination = new Map<
    string,
    { selectedAttributes: Record<string, string>; availableQuantity: number }
  >()

  for (const unit of product.units || []) {
    if ((unit.status || 'available') !== 'available') {
      continue
    }

    const selectedAttributes = canonicalizeAttributes(
      bookingAttributeAxes,
      unit.attributes || undefined,
    )
    const combinationKey = buildCombinationKey(bookingAttributeAxes, selectedAttributes)
    const current = byCombination.get(combinationKey)

    if (!current) {
      byCombination.set(combinationKey, {
        selectedAttributes,
        availableQuantity: 1,
      })
      continue
    }

    current.availableQuantity += 1
    byCombination.set(combinationKey, current)
  }

  return [...byCombination.entries()]
    .map(([combinationKey, value]) => ({
      combinationKey,
      selectedAttributes: value.selectedAttributes,
      availableQuantity: value.availableQuantity,
      totalQuantity: value.availableQuantity,
      reservedQuantity: 0,
      status: 'available' as const,
    }))
    .sort((a, b) => {
      const sortA = getDeterministicCombinationSortValue(
        bookingAttributeAxes,
        a.selectedAttributes,
      )
      const sortB = getDeterministicCombinationSortValue(
        bookingAttributeAxes,
        b.selectedAttributes,
      )
      return sortA.localeCompare(sortB, 'en')
    })
}

function getTrackedPoolCapacity(product: Product, combinations: CombinationAvailability[]) {
  if (!product.trackUnits) {
    return Math.max(0, product.quantity)
  }

  if (combinations.length === 0) {
    return Math.max(0, product.quantity)
  }

  return combinations.reduce((sum, combination) => {
    return sum + Math.max(0, combination.availableQuantity || 0)
  }, 0)
}

export function getLineQuantityConstraints(
  product: Product,
  line: SelectedProduct,
  productLines: SelectedProduct[],
): LineQuantityConstraints {
  const bookingAttributeAxes = getSortedAxes(product)
  const hasBookingAttributes = product.trackUnits && bookingAttributeAxes.length > 0
  const combinations = buildProductCombinations(product)

  const otherLines = productLines.filter((item) => item.lineId !== line.lineId)
  const otherProductQuantity = otherLines.reduce((sum, item) => sum + item.quantity, 0)

  const productCapacity = getTrackedPoolCapacity(product, combinations)
  const remainingProductCapacity = Math.max(0, productCapacity - otherProductQuantity)

  if (!hasBookingAttributes) {
    return {
      lineMaxQuantity: remainingProductCapacity,
      selectionCapacity: remainingProductCapacity,
      selectionMode: 'none',
      hasBookingAttributes: false,
    }
  }

  const normalizedSelectedAttributes = canonicalizeAttributes(
    bookingAttributeAxes,
    line.selectedAttributes,
  )
  const selection = getSelectionCapacity(
    bookingAttributeAxes,
    combinations,
    normalizedSelectedAttributes,
  )

  let selectionCapacity = selection.capacity

  if (selection.mode === 'full') {
    const lineCombinationKey = buildCombinationKey(
      bookingAttributeAxes,
      normalizedSelectedAttributes,
    )
    const sameCombinationUsedByOthers = otherLines.reduce((sum, otherLine) => {
      const otherAttributes = canonicalizeAttributes(
        bookingAttributeAxes,
        otherLine.selectedAttributes,
      )
      if (getSelectionMode(bookingAttributeAxes, otherAttributes) !== 'full') {
        return sum
      }

      const otherCombinationKey = buildCombinationKey(bookingAttributeAxes, otherAttributes)
      if (otherCombinationKey !== lineCombinationKey) {
        return sum
      }

      return sum + otherLine.quantity
    }, 0)

    const exactCapacity = getTotalAvailableForSelection(
      combinations,
      normalizedSelectedAttributes,
    )
    selectionCapacity = Math.max(0, exactCapacity - sameCombinationUsedByOthers)
  }

  return {
    lineMaxQuantity: Math.max(0, Math.min(remainingProductCapacity, selectionCapacity)),
    selectionCapacity,
    selectionMode: selection.mode,
    hasBookingAttributes: true,
  }
}
