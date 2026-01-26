'use server'

import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { products, categories, productPricingTiers, productAccessories } from '@/lib/db/schema'
import { eq, and, ne, inArray, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { productSchema, categorySchema, type ProductInput, type CategoryInput } from '@/lib/validations/product'
import { nanoid } from 'nanoid'
import { validatePricingTiers } from '@/lib/pricing'
import { notifyProductCreated, notifyProductUpdated } from '@/lib/discord/platform-notifications'

async function getStoreForUser() {
  return getCurrentStore()
}

export async function createProduct(data: ProductInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = productSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Validate pricing tiers if provided
  const pricingTiers = validated.data.pricingTiers || []
  if (pricingTiers.length > 0) {
    const tierValidation = validatePricingTiers(pricingTiers)
    if (!tierValidation.valid) {
      return { error: tierValidation.error }
    }
  }

  const price = validated.data.price.replace(',', '.')
  const deposit = validated.data.deposit
    ? validated.data.deposit.replace(',', '.')
    : '0'
  const quantity = parseInt(validated.data.quantity, 10)

  const productId = nanoid()

  await db.insert(products).values({
    id: productId,
    storeId: store.id,
    name: validated.data.name,
    description: validated.data.description || null,
    categoryId: validated.data.categoryId || null,
    price: price,
    deposit: deposit,
    pricingMode: validated.data.pricingMode || null,
    quantity: quantity,
    status: validated.data.status,
    images: validated.data.images || [],
    videoUrl: validated.data.videoUrl || null,
    taxSettings: validated.data.taxSettings || null,
  })

  // Create pricing tiers if provided
  if (pricingTiers.length > 0) {
    await db.insert(productPricingTiers).values(
      pricingTiers.map((tier, index) => ({
        id: nanoid(),
        productId: productId,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent.toFixed(2),
        displayOrder: index,
      }))
    )
  }

  notifyProductCreated(
    { id: store.id, name: store.name, slug: store.slug },
    validated.data.name
  ).catch(() => {})

  revalidatePath('/dashboard/products')
  return { success: true, productId }
}

export async function updateProduct(productId: string, data: ProductInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = productSchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Validate pricing tiers if provided
  const pricingTiers = validated.data.pricingTiers || []
  if (pricingTiers.length > 0) {
    const tierValidation = validatePricingTiers(pricingTiers)
    if (!tierValidation.valid) {
      return { error: tierValidation.error }
    }
  }

  // Verify product belongs to store
  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  const price = validated.data.price.replace(',', '.')
  const deposit = validated.data.deposit
    ? validated.data.deposit.replace(',', '.')
    : '0'
  const quantity = parseInt(validated.data.quantity, 10)

  await db
    .update(products)
    .set({
      name: validated.data.name,
      description: validated.data.description || null,
      categoryId: validated.data.categoryId || null,
      price: price,
      deposit: deposit,
      pricingMode: validated.data.pricingMode || null,
      quantity: quantity,
      status: validated.data.status,
      images: validated.data.images || [],
      videoUrl: validated.data.videoUrl || null,
      taxSettings: validated.data.taxSettings || null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))

  // Update pricing tiers: delete all existing and insert new ones
  await db.delete(productPricingTiers).where(eq(productPricingTiers.productId, productId))

  if (pricingTiers.length > 0) {
    await db.insert(productPricingTiers).values(
      pricingTiers.map((tier, index) => ({
        id: tier.id || nanoid(),
        productId: productId,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent.toFixed(2),
        displayOrder: index,
      }))
    )
  }

  // Update accessories: delete all existing and insert new ones
  const accessoryIds = validated.data.accessoryIds || []
  await db.delete(productAccessories).where(eq(productAccessories.productId, productId))

  if (accessoryIds.length > 0) {
    // Verify all accessories belong to the same store and are not the product itself
    const validAccessories = await db.query.products.findMany({
      where: and(
        eq(products.storeId, store.id),
        inArray(products.id, accessoryIds),
        ne(products.id, productId)
      ),
      columns: { id: true },
    })

    const validAccessoryIds = validAccessories.map((a) => a.id)

    if (validAccessoryIds.length > 0) {
      await db.insert(productAccessories).values(
        validAccessoryIds.map((accessoryId, index) => ({
          id: nanoid(),
          productId: productId,
          accessoryId: accessoryId,
          displayOrder: index,
        }))
      )
    }
  }

  notifyProductUpdated(
    { id: store.id, name: store.name, slug: store.slug },
    validated.data.name
  ).catch(() => {})

  revalidatePath('/dashboard/products')
  revalidatePath(`/dashboard/products/${productId}`)
  return { success: true }
}

export async function updateProductStatus(
  productId: string,
  status: 'draft' | 'active' | 'archived'
) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  await db
    .update(products)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId))

  revalidatePath('/dashboard/products')
  return { success: true }
}

export async function deleteProduct(productId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  // Delete accessory relations (both as product and as accessory)
  await db.delete(productAccessories).where(
    or(
      eq(productAccessories.productId, productId),
      eq(productAccessories.accessoryId, productId)
    )
  )

  await db.delete(products).where(eq(products.id, productId))

  revalidatePath('/dashboard/products')
  return { success: true }
}

export async function duplicateProduct(productId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
    with: {
      pricingTiers: true,
    },
  })

  if (!product) {
    return { error: 'errors.productNotFound' }
  }

  const newProductId = nanoid()

  // Note: the "(copy)" suffix will be translated on the client side
  await db.insert(products).values({
    id: newProductId,
    storeId: store.id,
    name: `${product.name} (copy)`,
    description: product.description,
    categoryId: product.categoryId,
    price: product.price,
    deposit: product.deposit,
    pricingMode: product.pricingMode,
    quantity: product.quantity,
    status: 'draft',
    images: product.images,
    videoUrl: product.videoUrl,
    taxSettings: product.taxSettings,
  })

  // Duplicate pricing tiers if any
  if (product.pricingTiers && product.pricingTiers.length > 0) {
    await db.insert(productPricingTiers).values(
      product.pricingTiers.map((tier) => ({
        id: nanoid(),
        productId: newProductId,
        minDuration: tier.minDuration,
        discountPercent: tier.discountPercent,
        displayOrder: tier.displayOrder,
      }))
    )
  }

  revalidatePath('/dashboard/products')
  return { success: true }
}

export async function getProduct(productId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return null
  }

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.storeId, store.id)),
    with: {
      category: true,
      pricingTiers: {
        orderBy: (tiers, { asc }) => [asc(tiers.displayOrder)],
      },
      accessories: {
        orderBy: (acc, { asc }) => [asc(acc.displayOrder)],
        with: {
          accessory: {
            columns: {
              id: true,
              name: true,
              price: true,
              images: true,
              status: true,
            },
          },
        },
      },
    },
  })

  return product
}

// Get all products available as accessories (excluding the current product)
export async function getAvailableAccessories(excludeProductId?: string) {
  const store = await getStoreForUser()
  if (!store) {
    return []
  }

  const allProducts = await db.query.products.findMany({
    where: and(
      eq(products.storeId, store.id),
      eq(products.status, 'active')
    ),
    columns: {
      id: true,
      name: true,
      price: true,
      images: true,
    },
    orderBy: (p, { asc }) => [asc(p.name)],
  })

  // Filter out the current product if provided
  if (excludeProductId) {
    return allProducts.filter((p) => p.id !== excludeProductId)
  }

  return allProducts
}

// Categories
export async function createCategory(data: CategoryInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = categorySchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  // Get max order
  const existingCategories = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
  })
  const maxOrder = Math.max(0, ...existingCategories.map((c) => c.order || 0))

  await db.insert(categories).values({
    storeId: store.id,
    name: validated.data.name,
    description: validated.data.description || null,
    order: maxOrder + 1,
  })

  revalidatePath('/dashboard/products')
  revalidatePath('/dashboard/categories')
  return { success: true }
}

export async function updateCategory(categoryId: string, data: CategoryInput) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const validated = categorySchema.safeParse(data)
  if (!validated.success) {
    return { error: 'errors.invalidData' }
  }

  const category = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.storeId, store.id)),
  })

  if (!category) {
    return { error: 'errors.categoryNotFound' }
  }

  await db
    .update(categories)
    .set({
      name: validated.data.name,
      description: validated.data.description || null,
      updatedAt: new Date(),
    })
    .where(eq(categories.id, categoryId))

  revalidatePath('/dashboard/products')
  revalidatePath('/dashboard/categories')
  return { success: true }
}

export async function deleteCategory(categoryId: string) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  const category = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.storeId, store.id)),
  })

  if (!category) {
    return { error: 'errors.categoryNotFound' }
  }

  // Remove category from products
  await db
    .update(products)
    .set({ categoryId: null })
    .where(eq(products.categoryId, categoryId))

  await db.delete(categories).where(eq(categories.id, categoryId))

  revalidatePath('/dashboard/products')
  revalidatePath('/dashboard/categories')
  return { success: true }
}

export async function getCategories() {
  const store = await getStoreForUser()
  if (!store) {
    return []
  }

  return db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  })
}

export async function updateProductsOrder(productIds: string[]) {
  const store = await getStoreForUser()
  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Verify all products belong to this store
  const storeProducts = await db.query.products.findMany({
    where: eq(products.storeId, store.id),
    columns: { id: true },
  })
  const storeProductIds = new Set(storeProducts.map((p) => p.id))

  // Filter to only include valid product IDs
  const validProductIds = productIds.filter((id) => storeProductIds.has(id))

  // Update display order for each product
  await Promise.all(
    validProductIds.map((productId, index) =>
      db
        .update(products)
        .set({
          displayOrder: index,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
    )
  )

  revalidatePath('/dashboard/products')
  return { success: true }
}
