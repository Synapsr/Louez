'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { db, products, productsTulip, stores } from '@louez/db'
import type { StoreSettings, TulipContractType, TulipPublicMode } from '@louez/types'

import { env } from '@/env'
import {
  TulipApiError,
  tulipCreateProduct,
  tulipListProducts,
  tulipListRenters,
  tulipUpdateProduct,
} from '@/lib/integrations/tulip/client'
import {
  getTulipApiKey,
  getTulipSettings,
  mergeTulipSettings,
} from '@/lib/integrations/tulip/settings'
import { encryptTulipApiKey } from '@/lib/integrations/tulip/crypto'
import { getCurrentStore } from '@/lib/store-context'
import type { StoreWithFullData } from '@/lib/store-context'

type ActionError = { error: string }

export type TulipIntegrationState = {
  connected: boolean
  apiKeyLast4: string | null
  connectedAt: string | null
  connectionIssue: string | null
  calendlyUrl: string
  settings: {
    publicMode: TulipPublicMode
    includeInFinalPrice: boolean
    renterUid: string | null
    contractType: TulipContractType
  }
  renters: Array<{
    uid: string
    enabled: boolean
  }>
  tulipProducts: Array<{
    id: string
    title: string
    productType: string | null
    valueExcl: number | null
    brand: string | null
    model: string | null
  }>
  products: Array<{
    id: string
    name: string
    price: number
    tulipProductId: string | null
  }>
}

const connectTulipApiKeySchema = z.object({
  apiKey: z.string().trim().min(8).max(500),
})

const updateTulipConfigurationSchema = z.object({
  publicMode: z.enum(['required', 'optional', 'no_public']),
  includeInFinalPrice: z.boolean(),
  renterUid: z.string().trim().min(1).max(50).nullable(),
  contractType: z.enum(['LCD', 'LMD', 'LLD']),
})

const upsertTulipProductMappingSchema = z.object({
  productId: z.string().length(21),
  tulipProductId: z.string().trim().min(1).max(50).nullable(),
})

const pushTulipProductUpdateSchema = z.object({
  productId: z.string().length(21),
  productType: z.string().trim().max(80).nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(1_000_000).nullable().optional(),
})

const createTulipProductSchema = z.object({
  productId: z.string().length(21),
  productType: z.string().trim().max(80).nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(1_000_000).nullable().optional(),
})

function toActionError(error: unknown): ActionError {
  if (error instanceof TulipApiError) {
    if (error.status === 401) {
      return { error: 'errors.tulipApiKeyInvalid' }
    }

    if (error.status === 403) {
      return { error: 'errors.tulipActionForbidden' }
    }

    return { error: 'errors.tulipApiUnavailable' }
  }

  if (error instanceof Error && error.message.startsWith('errors.')) {
    return { error: error.message }
  }

  return { error: 'errors.generic' }
}

async function getStoreOrError(): Promise<{ store: StoreWithFullData } | ActionError> {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  return { store }
}

async function getProductsWithMappings(storeId: string): Promise<TulipIntegrationState['products']> {
  const storeProducts = await db.query.products.findMany({
    where: and(eq(products.storeId, storeId), eq(products.status, 'active')),
    columns: {
      id: true,
      name: true,
      price: true,
    },
    orderBy: (products, { asc }) => [asc(products.name)],
  })

  if (storeProducts.length === 0) {
    return []
  }

  let mappings: Array<{ productId: string; tulipProductId: string }> = []

  try {
    mappings = await db.query.productsTulip.findMany({
      where: inArray(
        productsTulip.productId,
        storeProducts.map((product) => product.id),
      ),
      columns: {
        productId: true,
        tulipProductId: true,
      },
    })
  } catch (error) {
    console.warn('[tulip] Unable to read products_tulip mappings, falling back to unmapped state', {
      storeId,
      error,
    })
  }

  const mappingByProductId = new Map(
    mappings.map((mapping) => [mapping.productId, mapping.tulipProductId]),
  )

  return storeProducts.map((product) => ({
    id: product.id,
    name: product.name,
    price: Number(product.price),
    tulipProductId: mappingByProductId.get(product.id) ?? null,
  }))
}

function normalizeTulipProducts(rawProducts: Awaited<ReturnType<typeof tulipListProducts>>) {
  return rawProducts
    .map((product) => {
      const id = String(product.uid ?? product.product_id ?? '').trim()
      if (!id) return null

      return {
        id,
        title: product.title || id,
        productType: product.product_type || null,
        valueExcl:
          typeof product.value_excl === 'number' && Number.isFinite(product.value_excl)
            ? product.value_excl
            : null,
        brand:
          product.data?.brand && typeof product.data.brand === 'string'
            ? product.data.brand
            : null,
        model:
          product.data?.model && typeof product.data.model === 'string'
            ? product.data.model
            : null,
      }
    })
    .filter((product): product is NonNullable<typeof product> => product !== null)
    .sort((a, b) => a.title.localeCompare(b.title, 'en'))
}

export async function getTulipIntegrationStateAction(): Promise<TulipIntegrationState | ActionError> {
  try {
    const storeResult = await getStoreOrError()
    if ('error' in storeResult) {
      return { error: storeResult.error }
    }

    const { store } = storeResult
    const settings = getTulipSettings((store.settings as StoreSettings | null) || null)

    const productsListPromise = getProductsWithMappings(store.id)

    let renters: TulipIntegrationState['renters'] = []
    let tulipProducts: TulipIntegrationState['tulipProducts'] = []
    let connectionIssue: string | null = null

    const apiKey = getTulipApiKey((store.settings as StoreSettings | null) || null)
    if (apiKey) {
      const [rentersResult, tulipProductsResult] = await Promise.allSettled([
        tulipListRenters(apiKey),
        tulipListProducts(apiKey),
      ])

      if (rentersResult.status === 'fulfilled') {
        renters = rentersResult.value.sort((a, b) => a.uid.localeCompare(b.uid, 'en'))
      } else {
        connectionIssue = toActionError(rentersResult.reason).error
      }

      if (tulipProductsResult.status === 'fulfilled') {
        tulipProducts = normalizeTulipProducts(tulipProductsResult.value)
      } else if (!connectionIssue) {
        const productsError = tulipProductsResult.reason

        if (
          productsError instanceof TulipApiError &&
          (productsError.status === 401 || productsError.status === 403)
        ) {
          connectionIssue = toActionError(productsError).error
        } else {
          console.warn('[tulip] Unable to load Tulip products catalog, continuing without catalog', {
            storeId: store.id,
            error: productsError,
          })
        }
      }
    }

    return {
      connected: !!settings.apiKeyEncrypted,
      apiKeyLast4: settings.apiKeyLast4,
      connectedAt: settings.connectedAt,
      connectionIssue,
      calendlyUrl: env.TULIP_CALENDLY_URL || 'https://calendly.com/',
      settings: {
        publicMode: settings.publicMode,
        includeInFinalPrice: settings.includeInFinalPrice,
        renterUid: settings.renterUid,
        contractType: settings.contractType,
      },
      renters,
      tulipProducts,
      products: await productsListPromise,
    }
  } catch (error) {
    return toActionError(error)
  }
}

export async function connectTulipApiKeyAction(
  input: z.infer<typeof connectTulipApiKeySchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = connectTulipApiKeySchema.parse(input)

    const storeResult = await getStoreOrError()
    if ('error' in storeResult) {
      return { error: storeResult.error }
    }

    const { store } = storeResult
    const currentSettings = getTulipSettings((store.settings as StoreSettings | null) || null)

    const renters = await tulipListRenters(validated.apiKey)

    const selectedRenterUid =
      (currentSettings.renterUid && renters.some((renter) => renter.uid === currentSettings.renterUid)
        ? currentSettings.renterUid
        : null) ||
      renters.find((renter) => renter.enabled)?.uid ||
      renters[0]?.uid ||
      null

    const patchedSettings = mergeTulipSettings(
      (store.settings as StoreSettings | null) || null,
      {
        apiKeyEncrypted: encryptTulipApiKey(validated.apiKey),
        apiKeyLast4: validated.apiKey.slice(-4),
        connectedAt: new Date().toISOString(),
        renterUid: selectedRenterUid ?? undefined,
      },
    )

    await db
      .update(stores)
      .set({
        settings: patchedSettings,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/integrations')
    return { success: true }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateTulipConfigurationAction(
  input: z.infer<typeof updateTulipConfigurationSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = updateTulipConfigurationSchema.parse(input)

    const storeResult = await getStoreOrError()
    if ('error' in storeResult) {
      return { error: storeResult.error }
    }

    const { store } = storeResult
    const nextSettings = mergeTulipSettings((store.settings as StoreSettings | null) || null, {
      publicMode: validated.publicMode,
      includeInFinalPrice: validated.includeInFinalPrice,
      renterUid: validated.renterUid ?? undefined,
      contractType: validated.contractType,
    })

    await db
      .update(stores)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id))

    revalidatePath('/dashboard/settings/integrations')
    return { success: true }
  } catch (error) {
    return toActionError(error)
  }
}

export async function upsertTulipProductMappingAction(
  input: z.infer<typeof upsertTulipProductMappingSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = upsertTulipProductMappingSchema.parse(input)

    const storeResult = await getStoreOrError()
    if ('error' in storeResult) {
      return { error: storeResult.error }
    }

    const { store } = storeResult

    const product = await db.query.products.findFirst({
      where: and(
        eq(products.id, validated.productId),
        eq(products.storeId, store.id),
      ),
      columns: { id: true },
    })

    if (!product) {
      return { error: 'errors.productNotFound' }
    }

    if (!validated.tulipProductId) {
      await db.delete(productsTulip).where(eq(productsTulip.productId, validated.productId))
    } else {
      await db
        .insert(productsTulip)
        .values({
          id: nanoid(),
          productId: validated.productId,
          tulipProductId: validated.tulipProductId,
        })
        .onDuplicateKeyUpdate({
          set: {
            tulipProductId: validated.tulipProductId,
          },
        })
    }

    revalidatePath('/dashboard/settings/integrations')
    return { success: true }
  } catch (error) {
    return toActionError(error)
  }
}

export async function pushTulipProductUpdateAction(
  input: z.infer<typeof pushTulipProductUpdateSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = pushTulipProductUpdateSchema.parse(input)

    const storeResult = await getStoreOrError()
    if ('error' in storeResult) {
      return { error: storeResult.error }
    }

    const { store } = storeResult
    const storeSettings = (store.settings as StoreSettings | null) || null

    const apiKey = getTulipApiKey(storeSettings)
    if (!apiKey) {
      return { error: 'errors.tulipNotConfigured' }
    }

    const product = await db.query.products.findFirst({
      where: and(
        eq(products.id, validated.productId),
        eq(products.storeId, store.id),
      ),
      columns: {
        id: true,
        name: true,
        price: true,
      },
    })

    if (!product) {
      return { error: 'errors.productNotFound' }
    }

    const mapping = await db.query.productsTulip.findFirst({
      where: eq(productsTulip.productId, product.id),
      columns: {
        tulipProductId: true,
      },
    })

    if (!mapping?.tulipProductId) {
      return { error: 'errors.tulipProductNotMapped' }
    }

    const payload: Record<string, unknown> = {
      title: product.name,
      value_excl: validated.valueExcl ?? Number(product.price),
    }
    const productType = validated.productType?.trim()
    if (productType) {
      payload.product_type = productType
    }

    const brand = validated.brand?.trim()
    const model = validated.model?.trim()

    if (brand || model) {
      payload.data = {
        ...(brand ? { brand } : {}),
        ...(model ? { model } : {}),
      }
    }

    await tulipUpdateProduct(apiKey, mapping.tulipProductId, payload)

    return { success: true }
  } catch (error) {
    return toActionError(error)
  }
}

export async function createTulipProductAction(
  input: z.infer<typeof createTulipProductSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = createTulipProductSchema.parse(input)

    const storeResult = await getStoreOrError()
    if ('error' in storeResult) {
      return { error: storeResult.error }
    }

    const { store } = storeResult
    const storeSettings = (store.settings as StoreSettings | null) || null

    const apiKey = getTulipApiKey(storeSettings)
    if (!apiKey) {
      return { error: 'errors.tulipNotConfigured' }
    }

    const product = await db.query.products.findFirst({
      where: and(
        eq(products.id, validated.productId),
        eq(products.storeId, store.id),
      ),
      columns: {
        id: true,
        name: true,
        description: true,
        price: true,
      },
    })

    if (!product) {
      return { error: 'errors.productNotFound' }
    }

    const existingMapping = await db.query.productsTulip.findFirst({
      where: eq(productsTulip.productId, product.id),
      columns: {
        tulipProductId: true,
      },
    })

    if (existingMapping?.tulipProductId) {
      return { error: 'errors.tulipProductAlreadyMapped' }
    }

    const createdProduct = await tulipCreateProduct(apiKey, {
      uid: randomUUID(),
      product_type: validated.productType?.trim() || 'event',
      title: product.name,
      description: product.description ?? undefined,
      data: {
        product_subtype: 'standard',
        ...(validated.brand?.trim() ? { brand: validated.brand.trim() } : {}),
        ...(validated.model?.trim() ? { model: validated.model.trim() } : {}),
      },
      value_excl: validated.valueExcl ?? Number(product.price),
    })

    const tulipProductId = String(createdProduct?.uid ?? createdProduct?.product_id ?? '').trim()

    if (!tulipProductId) {
      return { error: 'errors.tulipInvalidProductResponse' }
    }

    await db
      .insert(productsTulip)
      .values({
        id: nanoid(),
        productId: product.id,
        tulipProductId,
      })
      .onDuplicateKeyUpdate({
        set: {
          tulipProductId,
        },
      })

    revalidatePath('/dashboard/settings/integrations')
    return { success: true }
  } catch (error) {
    return toActionError(error)
  }
}
