/**
 * Products Generator
 *
 * Generates categories, products, pricing tiers, accessories, and product units.
 */

import type { StoreConfig } from '../config'
import {
  generateId,
  generateUnitIdentifier,
  pickRandom,
  pickRandomMultiple,
  randomInt,
  chance,
  weightedRandom,
  logProgress,
} from '../utils'
import {
  getProductsForSpecialty,
  UNIT_NOTES_TEMPLATES,
  UNIT_STATUS_DISTRIBUTION,
  type ProductTemplate,
} from '../data/product-templates'

export interface GeneratedCategory {
  id: string
  storeId: string
  name: string
  description: string | null
  imageUrl: string | null
  order: number
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedProduct {
  id: string
  storeId: string
  categoryId: string | null
  name: string
  description: string | null
  images: string[]
  price: string
  deposit: string
  pricingMode: 'hour' | 'day' | 'week'
  videoUrl: string | null
  taxSettings: { inheritFromStore: boolean; customRate?: number } | null
  enforceStrictTiers: boolean
  quantity: number
  trackUnits: boolean
  displayOrder: number
  status: 'draft' | 'active' | 'archived'
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedPricingTier {
  id: string
  productId: string
  minDuration: number
  discountPercent: string
  displayOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedProductAccessory {
  id: string
  productId: string
  accessoryId: string
  displayOrder: number
  createdAt: Date
}

export interface GeneratedProductUnit {
  id: string
  productId: string
  identifier: string
  notes: string | null
  status: 'available' | 'maintenance' | 'retired'
  createdAt: Date
  updatedAt: Date
}

export interface ProductsGeneratorResult {
  categories: GeneratedCategory[]
  products: GeneratedProduct[]
  pricingTiers: GeneratedPricingTier[]
  accessories: GeneratedProductAccessory[]
  productUnits: GeneratedProductUnit[]
  /** Map from original template name to product ID */
  productIdMap: Map<string, string>
  /** Map from category name to category ID */
  categoryIdMap: Map<string, string>
  /** Accessory product IDs for linking */
  accessoryProductIds: string[]
}

/**
 * Generate placeholder image URL from picsum
 */
function generatePlaceholderImage(seed: number, width = 800, height = 600): string {
  return `https://picsum.photos/seed/${seed}/${width}/${height}`
}

/**
 * Generate product images
 */
function generateProductImages(productIndex: number, count = 3): string[] {
  const images: string[] = []
  for (let i = 0; i < count; i++) {
    // Use product index + image index as seed for consistent images
    images.push(generatePlaceholderImage(productIndex * 10 + i))
  }
  return images
}

/**
 * Generate all products data for a store
 */
export function generateProducts(
  storeId: string,
  storeConfig: StoreConfig,
  now: Date
): ProductsGeneratorResult {
  const { categories: categoryTemplates, products: productTemplates } = getProductsForSpecialty(
    storeConfig.specialty
  )

  const categories: GeneratedCategory[] = []
  const products: GeneratedProduct[] = []
  const pricingTiers: GeneratedPricingTier[] = []
  const accessories: GeneratedProductAccessory[] = []
  const productUnits: GeneratedProductUnit[] = []
  const productIdMap = new Map<string, string>()
  const categoryIdMap = new Map<string, string>()
  const accessoryProductIds: string[] = []

  // Generate categories
  for (const template of categoryTemplates) {
    const categoryId = generateId()
    categoryIdMap.set(template.name, categoryId)

    categories.push({
      id: categoryId,
      storeId,
      name: template.name,
      description: template.description,
      imageUrl: generatePlaceholderImage(categories.length + 100, 600, 400),
      order: template.order,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Determine which products to use based on productCount
  let selectedTemplates = productTemplates
  if (productTemplates.length > storeConfig.productCount) {
    // Prioritize active products, then include some draft/archived
    const activeTemplates = productTemplates.filter((p) => p.status === 'active')
    const otherTemplates = productTemplates.filter((p) => p.status !== 'active')

    const activeCount = Math.min(
      activeTemplates.length,
      Math.floor(storeConfig.productCount * 0.9)
    )
    const otherCount = storeConfig.productCount - activeCount

    selectedTemplates = [
      ...pickRandomMultiple(activeTemplates, activeCount),
      ...pickRandomMultiple(otherTemplates, otherCount),
    ]
  }

  // Generate products
  for (let i = 0; i < selectedTemplates.length; i++) {
    const template = selectedTemplates[i]
    const productId = generateId()
    productIdMap.set(template.name, productId)

    // Track accessory products
    if (template.category.toLowerCase().includes('accessoire') ||
        template.category.toLowerCase().includes('protection') ||
        template.category.toLowerCase().includes('sécurité')) {
      accessoryProductIds.push(productId)
    }

    const categoryId = categoryIdMap.get(template.category) ?? null

    // Determine if this product should track units
    const shouldTrackUnits = storeConfig.trackUnits && (template.trackUnits ?? false)

    // Generate pricing mode (always explicit at product level)
    let pricingMode: 'hour' | 'day' | 'week' = storeConfig.pricingMode
    if (chance(0.2)) {
      // 20% of products override the store default mode
      const modes: ('hour' | 'day' | 'week')[] = ['hour', 'day', 'week']
      pricingMode = pickRandom(modes.filter((m) => m !== storeConfig.pricingMode))
    }

    // Generate tax settings (most inherit, some override)
    let taxSettings: { inheritFromStore: boolean; customRate?: number } | null = null
    if (storeConfig.taxEnabled && chance(0.1)) {
      // 10% of products have custom tax
      taxSettings = {
        inheritFromStore: false,
        customRate: pickRandom([5.5, 10, 20]), // French VAT rates
      }
    }

    const createdAt = new Date(now.getTime() - randomInt(30, 180) * 24 * 60 * 60 * 1000)

    products.push({
      id: productId,
      storeId,
      categoryId,
      name: template.name,
      description: template.description,
      images: generateProductImages(i),
      price: template.price.toFixed(2),
      deposit: template.deposit.toFixed(2),
      pricingMode,
      videoUrl: chance(0.05) ? 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' : null,
      taxSettings,
      enforceStrictTiers: chance(0.1), // 10% use strict tier mode
      quantity: template.quantity,
      trackUnits: shouldTrackUnits,
      displayOrder: i,
      status: template.status,
      createdAt,
      updatedAt: now,
    })

    // Generate pricing tiers
    if (template.pricingTiers && template.pricingTiers.length > 0) {
      for (let j = 0; j < template.pricingTiers.length; j++) {
        const tier = template.pricingTiers[j]
        pricingTiers.push({
          id: generateId(),
          productId,
          minDuration: tier.minDuration ?? 1,
          discountPercent: tier.discountPercent.toFixed(6),
          displayOrder: j,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    // Generate product units if tracking is enabled
    if (shouldTrackUnits && template.quantity > 0 && template.status === 'active') {
      const unitPrefix = template.unitPrefix ?? template.name.substring(0, 3).toUpperCase()

      for (let u = 0; u < template.quantity; u++) {
        const status = weightedRandom([
          { item: 'available' as const, weight: UNIT_STATUS_DISTRIBUTION.available },
          { item: 'maintenance' as const, weight: UNIT_STATUS_DISTRIBUTION.maintenance },
          { item: 'retired' as const, weight: UNIT_STATUS_DISTRIBUTION.retired },
        ])

        const notes = chance(0.6) ? pickRandom(UNIT_NOTES_TEMPLATES) : null

        productUnits.push({
          id: generateId(),
          productId,
          identifier: generateUnitIdentifier(unitPrefix, u),
          notes,
          status,
          createdAt: new Date(createdAt.getTime() + randomInt(0, 7) * 24 * 60 * 60 * 1000),
          updatedAt: now,
        })
      }
    }

    logProgress(i + 1, selectedTemplates.length, `Products for ${storeConfig.name}`)
  }

  // Generate product accessories relationships
  // Link main products (bikes) to accessory products
  const mainProducts = products.filter(
    (p) =>
      p.status === 'active' &&
      !accessoryProductIds.includes(p.id) &&
      parseFloat(p.price) >= 10 // Main products are typically more expensive
  )

  for (const mainProduct of mainProducts) {
    // Each main product gets 1-3 accessories
    const numAccessories = randomInt(1, Math.min(3, accessoryProductIds.length))
    const selectedAccessories = pickRandomMultiple(accessoryProductIds, numAccessories)

    for (let i = 0; i < selectedAccessories.length; i++) {
      accessories.push({
        id: generateId(),
        productId: mainProduct.id,
        accessoryId: selectedAccessories[i],
        displayOrder: i,
        createdAt: now,
      })
    }
  }

  return {
    categories,
    products,
    pricingTiers,
    accessories,
    productUnits,
    productIdMap,
    categoryIdMap,
    accessoryProductIds,
  }
}
