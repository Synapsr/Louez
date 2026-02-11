import { db, products, stores } from '@louez/db'
import type {
  BookingAttributeAxis,
  CombinationResolutionResult,
  UnitAttributes,
} from '@louez/types'
import {
  DEFAULT_COMBINATION_KEY,
  getDeterministicCombinationSortValue,
  matchesSelectedAttributes,
} from '@louez/utils'
import { and, eq } from 'drizzle-orm'
import { ApiServiceError } from './errors'
import { getStorefrontAvailability } from './availability'

interface ResolveStorefrontCombinationParams {
  storeSlug: string
  productId: string
  quantity: number
  startDate: string
  endDate: string
  selectedAttributes?: UnitAttributes
}

export async function resolveStorefrontCombination(
  params: ResolveStorefrontCombinationParams,
): Promise<CombinationResolutionResult> {
  const { storeSlug, productId, quantity, startDate, endDate, selectedAttributes } = params

  if (quantity < 1) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.invalidData')
  }

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, storeSlug),
    columns: { id: true },
  })

  if (!store) {
    throw new ApiServiceError('NOT_FOUND', 'errors.storeNotFound')
  }

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.storeId, store.id),
      eq(products.status, 'active'),
    ),
  })

  if (!product) {
    throw new ApiServiceError('NOT_FOUND', 'errors.productNotFound')
  }

  const availability = await getStorefrontAvailability({
    storeSlug,
    startDate,
    endDate,
    productIds: [productId],
  })

  const availableProduct = availability.products[0]
  if (!availableProduct) {
    throw new ApiServiceError('NOT_FOUND', 'errors.productNotFound')
  }

  if (!product.trackUnits) {
    if (availableProduct.availableQuantity < quantity) {
      throw new ApiServiceError('BAD_REQUEST', 'errors.productNoLongerAvailable', {
        name: product.name,
      })
    }

    return {
      combinationKey: DEFAULT_COMBINATION_KEY,
      selectedAttributes: {},
      availableQuantity: availableProduct.availableQuantity,
    }
  }

  const combinations = availableProduct.combinations || []

  const candidateCombinations = combinations
    .filter((combination) => matchesSelectedAttributes(selectedAttributes, combination.selectedAttributes))
    .sort((a, b) => {
      const sortA = getDeterministicCombinationSortValue(
        (product.bookingAttributeAxes || []) as BookingAttributeAxis[],
        a.selectedAttributes,
      )
      const sortB = getDeterministicCombinationSortValue(
        (product.bookingAttributeAxes || []) as BookingAttributeAxis[],
        b.selectedAttributes,
      )
      return sortA.localeCompare(sortB, 'en')
    })

  const resolvedCombination = candidateCombinations.find(
    (combination) => combination.availableQuantity >= quantity,
  )

  if (!resolvedCombination) {
    throw new ApiServiceError('BAD_REQUEST', 'errors.productNoLongerAvailable', {
      name: product.name,
    })
  }

  return {
    combinationKey: resolvedCombination.combinationKey,
    selectedAttributes: resolvedCombination.selectedAttributes,
    availableQuantity: resolvedCombination.availableQuantity,
  }
}
