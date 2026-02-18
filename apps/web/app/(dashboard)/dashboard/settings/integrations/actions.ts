'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db, products, productsTulip, stores } from '@louez/db';
import type {
  StoreSettings,
  TulipContractType,
  TulipPublicMode,
} from '@louez/types';

import {
  TulipApiError,
  tulipCreateProduct,
  tulipListProducts,
  tulipListRenters,
  tulipUpdateProduct,
} from '@/lib/integrations/tulip/client';
import { encryptTulipApiKey } from '@/lib/integrations/tulip/crypto';
import {
  getTulipApiKey,
  getTulipSettings,
  mergeTulipSettings,
} from '@/lib/integrations/tulip/settings';
import {
  getIntegration,
  getIntegrationDetail,
  listByCategory,
  listCategories,
  listIntegrations,
} from '@/lib/integrations/registry';
import type {
  IntegrationCatalogItem,
  IntegrationCategorySummary,
  IntegrationDetail,
} from '@/lib/integrations/registry/types';
import { getCurrentStore } from '@/lib/store-context';
import type { StoreWithFullData } from '@/lib/store-context';

import { env } from '@/env';

type ActionError = { error: string };

export type IntegrationsCatalogState = {
  categories: IntegrationCategorySummary[];
  integrations: IntegrationCatalogItem[];
};

export type IntegrationsCategoryState = {
  category: string;
  categories: IntegrationCategorySummary[];
  integrations: IntegrationCatalogItem[];
};

export type IntegrationDetailState = {
  integration: IntegrationDetail;
};

const TULIP_PRODUCT_TYPES = [
  'bike',
  'wintersports',
  'watersports',
  'event',
  'high-tech',
  'small-tools',
] as const;

const TULIP_PRODUCT_SUBTYPES = [
  'standard',
  'electric',
  'cargo',
  'remorque',
  'furniture',
  'tent',
  'decorations',
  'tableware',
  'entertainment',
  'action-cam',
  'drone',
  'camera',
  'video-camera',
  'stabilizer',
  'phone',
  'computer',
  'tablet',
  'small-appliance',
  'large-appliance',
  'construction-equipment',
  'diy-tools',
  'electric-diy-tools',
  'gardening-tools',
  'electric-gardening-tools',
  'kitesurf',
  'foil',
  'windsurf',
  'sailboat',
  'kayak',
  'canoe',
  'water-ski',
  'wakeboard',
  'mono-ski',
  'buoy',
  'paddle',
  'surf',
  'pedalo',
  'ski',
  'snowboard',
  'snowshoe',
] as const;

type TulipProductTypeValue = (typeof TULIP_PRODUCT_TYPES)[number];
type TulipProductSubtypeValue = (typeof TULIP_PRODUCT_SUBTYPES)[number];

const TULIP_SUBTYPES_BY_TYPE: Record<
  TulipProductTypeValue,
  readonly TulipProductSubtypeValue[]
> = {
  bike: ['standard', 'electric', 'cargo', 'remorque'],
  wintersports: ['ski', 'snowboard', 'snowshoe'],
  watersports: [
    'kitesurf',
    'foil',
    'windsurf',
    'sailboat',
    'kayak',
    'canoe',
    'water-ski',
    'wakeboard',
    'mono-ski',
    'buoy',
    'paddle',
    'surf',
    'pedalo',
  ],
  event: ['furniture', 'tent', 'decorations', 'tableware', 'entertainment'],
  'high-tech': [
    'action-cam',
    'drone',
    'camera',
    'video-camera',
    'stabilizer',
    'phone',
    'computer',
    'tablet',
  ],
  'small-tools': [
    'small-appliance',
    'large-appliance',
    'construction-equipment',
    'diy-tools',
    'electric-diy-tools',
    'gardening-tools',
    'electric-gardening-tools',
  ],
};

function isSubtypeAllowedForType(
  productType: TulipProductTypeValue,
  subtype: TulipProductSubtypeValue,
): boolean {
  return TULIP_SUBTYPES_BY_TYPE[productType].includes(subtype);
}

function getDefaultSubtypeForType(
  productType: TulipProductTypeValue,
): TulipProductSubtypeValue {
  return TULIP_SUBTYPES_BY_TYPE[productType][0] ?? 'standard';
}

function getTulipProductId(value: { product_id?: string | null }): string | null {
  const id =
    typeof value.product_id === 'string' ? value.product_id.trim() : '';
  return id || null;
}

function getTulipLegacyUid(value: { uid?: string | null }): string | null {
  const uid = typeof value.uid === 'string' ? value.uid.trim() : '';
  return uid || null;
}

const tulipPurchasedDateSchema = z.union([
  z.string().datetime({ offset: true }),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
]);

const listIntegrationsCatalogSchema = z.object({});

const listIntegrationsCategorySchema = z.object({
  category: z.string().trim().min(1).max(60),
});

const getIntegrationDetailSchema = z.object({
  integrationId: z.string().trim().min(1).max(60),
});

const setIntegrationEnabledSchema = z.object({
  integrationId: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
});

export type TulipIntegrationState = {
  connected: boolean;
  apiKeyLast4: string | null;
  connectedAt: string | null;
  connectionIssue: string | null;
  calendlyUrl: string;
  settings: {
    publicMode: TulipPublicMode;
    includeInFinalPrice: boolean;
    renterUid: string | null;
    contractType: TulipContractType;
  };
  renters: Array<{
    uid: string;
    enabled: boolean;
  }>;
  tulipProducts: Array<{
    id: string;
    title: string;
    productType: string | null;
    productSubtype: string | null;
    purchasedDate: string | null;
    valueExcl: number | null;
    brand: string | null;
    model: string | null;
  }>;
  products: Array<{
    id: string;
    name: string;
    price: number;
    tulipProductId: string | null;
  }>;
};

const connectTulipApiKeySchema = z.object({
  apiKey: z.string().trim().min(8).max(500),
});

const updateTulipConfigurationSchema = z.object({
  publicMode: z.enum(['required', 'optional', 'no_public']),
  includeInFinalPrice: z.boolean(),
  contractType: z.enum(['LCD', 'LMD', 'LLD']),
});

const upsertTulipProductMappingSchema = z.object({
  productId: z.string().length(21),
  tulipProductId: z.string().trim().min(1).max(50).nullable(),
});

const pushTulipProductUpdateSchema = z.object({
  productId: z.string().length(21),
  title: z.string().trim().max(255).nullable().optional(),
  productType: z.enum(TULIP_PRODUCT_TYPES).nullable().optional(),
  productSubtype: z.enum(TULIP_PRODUCT_SUBTYPES).nullable().optional(),
  purchasedDate: tulipPurchasedDateSchema.nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(1_000_000).nullable().optional(),
});

const createTulipProductSchema = z.object({
  productId: z.string().length(21),
  title: z.string().trim().max(255).nullable().optional(),
  productType: z.enum(TULIP_PRODUCT_TYPES).nullable().optional(),
  productSubtype: z.enum(TULIP_PRODUCT_SUBTYPES).nullable().optional(),
  purchasedDate: tulipPurchasedDateSchema.nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(1_000_000).nullable().optional(),
});

const disconnectTulipSchema = z.object({});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getTulipErrorCode(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const errorObject = (payload as { error?: unknown }).error;
  if (!errorObject || typeof errorObject !== 'object') {
    return null;
  }

  const code = (errorObject as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

function toActionError(error: unknown): ActionError {
  if (error instanceof TulipApiError) {
    console.error('[tulip] API error', {
      status: error.status,
      message: error.message,
      payload: error.payload,
    });

    if (error.status === 401) {
      return { error: 'errors.tulipApiKeyInvalid' };
    }

    if (error.status === 403) {
      return { error: 'errors.tulipActionForbidden' };
    }

    if (error.status === 400) {
      const code = getTulipErrorCode(error.payload);
      if (code === 4009) {
        return { error: 'errors.tulipProductSubtypeInvalid' };
      }
      if (code === 4005) {
        return { error: 'errors.tulipProductPayloadInvalid' };
      }
      if (code === 4999) {
        return { error: 'errors.tulipProductNotFound' };
      }
    }

    return { error: 'errors.tulipApiUnavailable' };
  }

  if (error instanceof Error && error.message.startsWith('errors.')) {
    return { error: error.message };
  }

  return { error: 'errors.generic' };
}

async function getStoreOrError(): Promise<
  { store: StoreWithFullData } | ActionError
> {
  const store = await getCurrentStore();

  if (!store) {
    return { error: 'errors.unauthorized' };
  }

  return { store };
}

async function getProductsWithMappings(
  storeId: string,
): Promise<TulipIntegrationState['products']> {
  const storeProducts = await db.query.products.findMany({
    where: and(eq(products.storeId, storeId), eq(products.status, 'active')),
    columns: {
      id: true,
      name: true,
      price: true,
    },
    orderBy: (products, { asc }) => [asc(products.name)],
  });

  if (storeProducts.length === 0) {
    return [];
  }

  let mappings: Array<{ productId: string; tulipProductId: string }> = [];

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
    });
  } catch (error) {
    console.warn(
      '[tulip] Unable to read products_tulip mappings, falling back to unmapped state',
      {
        storeId,
        error,
      },
    );
  }

  const mappingByProductId = new Map(
    mappings.map((mapping) => [mapping.productId, mapping.tulipProductId]),
  );

  return storeProducts.map((product) => ({
    id: product.id,
    name: product.name,
    price: Number(product.price),
    tulipProductId: mappingByProductId.get(product.id) ?? null,
  }));
}

function normalizeTulipProducts(
  rawProducts: Awaited<ReturnType<typeof tulipListProducts>>,
) {
  return rawProducts
    .map((product) => {
      const id = getTulipProductId(product);
      if (!id) return null;

      return {
        id,
        title: product.title || id,
        productType: product.product_type || null,
        productSubtype: product.data?.product_subtype || null,
        purchasedDate:
          typeof product.purchased_date === 'string' &&
          product.purchased_date.trim()
            ? product.purchased_date
            : null,
        valueExcl:
          typeof product.value_excl === 'number' &&
          Number.isFinite(product.value_excl)
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
      };
    })
    .filter(
      (product): product is NonNullable<typeof product> => product !== null,
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'en'));
}

export async function listIntegrationsCatalogAction(
  input: z.infer<typeof listIntegrationsCatalogSchema>,
): Promise<IntegrationsCatalogState | ActionError> {
  try {
    listIntegrationsCatalogSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const settings = (storeResult.store.settings as StoreSettings | null) || null;

    return {
      categories: listCategories(settings),
      integrations: listIntegrations(settings),
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function listIntegrationsCategoryAction(
  input: z.infer<typeof listIntegrationsCategorySchema>,
): Promise<IntegrationsCategoryState | ActionError> {
  try {
    const validated = listIntegrationsCategorySchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const settings = (storeResult.store.settings as StoreSettings | null) || null;
    const categories = listCategories(settings);
    const integrations = listByCategory(settings, validated.category);

    if (integrations.length === 0 && !categories.some((item) => item.id === validated.category)) {
      return { error: 'errors.integrationCategoryNotFound' };
    }

    return {
      category: validated.category,
      categories,
      integrations,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function getIntegrationDetailAction(
  input: z.infer<typeof getIntegrationDetailSchema>,
): Promise<IntegrationDetailState | ActionError> {
  try {
    const validated = getIntegrationDetailSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const settings = (storeResult.store.settings as StoreSettings | null) || null;
    const integration = getIntegrationDetail(settings, validated.integrationId);

    if (!integration) {
      return { error: 'errors.integrationNotFound' };
    }

    return { integration };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setIntegrationEnabledAction(
  input: z.infer<typeof setIntegrationEnabledSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = setIntegrationEnabledSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const integration = getIntegration(validated.integrationId);
    if (!integration) {
      return { error: 'errors.integrationNotFound' };
    }

    const currentSettings = (store.settings as StoreSettings | null) || null;
    const nextSettings = integration.adapter.setEnabled(
      currentSettings,
      validated.enabled,
    );

    await db
      .update(stores)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    revalidatePath('/dashboard/settings/integrations');
    revalidatePath('/dashboard/settings/integrations/categories/[category]', 'page');
    revalidatePath('/dashboard/settings/integrations/[integrationId]', 'page');

    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function getTulipIntegrationStateAction(): Promise<
  TulipIntegrationState | ActionError
> {
  try {
    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const settings = getTulipSettings(
      (store.settings as StoreSettings | null) || null,
    );

    const productsListPromise = getProductsWithMappings(store.id);

    let renters: TulipIntegrationState['renters'] = [];
    let tulipProducts: TulipIntegrationState['tulipProducts'] = [];
    let connectionIssue: string | null = null;
    let didLoadTulipProducts = false;

    const apiKey = getTulipApiKey(
      (store.settings as StoreSettings | null) || null,
    );
    if (apiKey) {
      const [rentersResult, tulipProductsResult] = await Promise.allSettled([
        tulipListRenters(apiKey),
        tulipListProducts(apiKey),
      ]);

      if (rentersResult.status === 'fulfilled') {
        renters = rentersResult.value.sort((a, b) =>
          a.uid.localeCompare(b.uid, 'en'),
        );
      } else {
        connectionIssue = toActionError(rentersResult.reason).error;
      }

      if (tulipProductsResult.status === 'fulfilled') {
        tulipProducts = normalizeTulipProducts(tulipProductsResult.value);
        didLoadTulipProducts = true;
      } else if (!connectionIssue) {
        const productsError = tulipProductsResult.reason;

        if (
          productsError instanceof TulipApiError &&
          (productsError.status === 401 || productsError.status === 403)
        ) {
          connectionIssue = toActionError(productsError).error;
        } else {
          console.warn(
            '[tulip] Unable to load Tulip products catalog, continuing without catalog',
            {
              storeId: store.id,
              error: productsError,
            },
          );
        }
      }
    }

    const rawProducts = await productsListPromise;
    const products = didLoadTulipProducts
      ? (() => {
          const validTulipProductIds = new Set(tulipProducts.map((tp) => tp.id));
          return rawProducts.map((product) => {
            if (
              product.tulipProductId &&
              !validTulipProductIds.has(product.tulipProductId)
            ) {
              return { ...product, tulipProductId: null };
            }

            return product;
          });
        })()
      : rawProducts;

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
      products,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function connectTulipApiKeyAction(
  input: z.infer<typeof connectTulipApiKeySchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = connectTulipApiKeySchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const currentSettings = getTulipSettings(
      (store.settings as StoreSettings | null) || null,
    );

    console.info('[tulip][connect] validating api key', {
      storeId: store.id,
      keyLength: validated.apiKey.length,
      keySuffix: validated.apiKey.slice(-4),
    });

    const renters = await tulipListRenters(validated.apiKey);

    console.info('[tulip][connect] renters loaded', {
      storeId: store.id,
      rentersCount: renters.length,
    });

    const selectedRenterUid =
      (currentSettings.renterUid &&
      renters.some((renter) => renter.uid === currentSettings.renterUid)
        ? currentSettings.renterUid
        : null) ||
      renters.find((renter) => renter.enabled)?.uid ||
      renters[0]?.uid ||
      null;

    const patchedSettings = mergeTulipSettings(
      (store.settings as StoreSettings | null) || null,
      {
        apiKeyEncrypted: encryptTulipApiKey(validated.apiKey),
        apiKeyLast4: validated.apiKey.slice(-4),
        connectedAt: new Date().toISOString(),
        renterUid: selectedRenterUid ?? undefined,
      },
    );

    await db
      .update(stores)
      .set({
        settings: patchedSettings,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    console.info('[tulip][connect] api key saved', {
      storeId: store.id,
      apiKeyLast4: validated.apiKey.slice(-4),
      selectedRenterUid,
    });

    revalidatePath('/dashboard/settings/integrations');
    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateTulipConfigurationAction(
  input: z.infer<typeof updateTulipConfigurationSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = updateTulipConfigurationSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const nextSettings = mergeTulipSettings(
      (store.settings as StoreSettings | null) || null,
      {
        publicMode: validated.publicMode,
        includeInFinalPrice: validated.includeInFinalPrice,
        contractType: validated.contractType,
      },
    );

    await db
      .update(stores)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(stores.id, store.id));

    revalidatePath('/dashboard/settings/integrations');
    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function upsertTulipProductMappingAction(
  input: z.infer<typeof upsertTulipProductMappingSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = upsertTulipProductMappingSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;

    const product = await db.query.products.findFirst({
      where: and(
        eq(products.id, validated.productId),
        eq(products.storeId, store.id),
      ),
      columns: { id: true },
    });

    if (!product) {
      return { error: 'errors.productNotFound' };
    }

    if (!validated.tulipProductId) {
      await db
        .delete(productsTulip)
        .where(eq(productsTulip.productId, validated.productId));
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
        });
    }

    revalidatePath('/dashboard/settings/integrations');
    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function pushTulipProductUpdateAction(
  input: z.infer<typeof pushTulipProductUpdateSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = pushTulipProductUpdateSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const storeSettings = (store.settings as StoreSettings | null) || null;

    const apiKey = getTulipApiKey(storeSettings);
    if (!apiKey) {
      return { error: 'errors.tulipNotConfigured' };
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
    });

    if (!product) {
      return { error: 'errors.productNotFound' };
    }

    const mapping = await db.query.productsTulip.findFirst({
      where: eq(productsTulip.productId, product.id),
      columns: {
        tulipProductId: true,
      },
    });

    if (!mapping?.tulipProductId) {
      return { error: 'errors.tulipProductNotMapped' };
    }

    const title = validated.title?.trim() || null;
    const payload: Record<string, unknown> = {
      title: title || product.name,
      value_excl: validated.valueExcl ?? Number(product.price),
    };
    const productType = validated.productType;
    let resolvedSubtype = validated.productSubtype ?? null;
    if (productType) {
      payload.product_type = productType;
      if (!resolvedSubtype) {
        resolvedSubtype = getDefaultSubtypeForType(productType);
      } else if (!isSubtypeAllowedForType(productType, resolvedSubtype)) {
        console.warn('[tulip][update-product] subtype incompatible with selected product type, using default subtype', {
          storeId: store.id,
          productId: product.id,
          productType,
          requestedSubtype: resolvedSubtype,
        });
        resolvedSubtype = getDefaultSubtypeForType(productType);
      }
    }

    const brand = validated.brand?.trim();
    const model = validated.model?.trim();
    const purchasedDate = validated.purchasedDate
      ? new Date(validated.purchasedDate).toISOString()
      : null;

    if (resolvedSubtype || brand || model) {
      payload.data = {
        ...(resolvedSubtype ? { product_subtype: resolvedSubtype } : {}),
        ...(brand ? { brand } : {}),
        ...(model ? { model } : {}),
      };
    }
    if (purchasedDate) {
      payload.purchased_date = purchasedDate;
    }

    try {
      await tulipUpdateProduct(apiKey, mapping.tulipProductId, payload);
    } catch (error) {
      if (error instanceof TulipApiError && getTulipErrorCode(error.payload) === 4999) {
        console.warn('[tulip][update-product] mapped product id not found, attempting mapping repair', {
          storeId: store.id,
          productId: product.id,
          mappedTulipProductId: mapping.tulipProductId,
        });

        const rawCatalog = await tulipListProducts(apiKey);
        const payloadTitle = typeof payload.title === 'string' ? payload.title : product.name;
        const payloadData =
          payload.data && typeof payload.data === 'object'
            ? (payload.data as { brand?: string; model?: string })
            : {};
        const payloadBrand = typeof payloadData.brand === 'string' ? payloadData.brand : null;
        const payloadModel = typeof payloadData.model === 'string' ? payloadData.model : null;

        const candidates = rawCatalog
          .map((candidate) => {
            const id = getTulipProductId(candidate);
            if (!id) return null;

            return {
              id,
              uid: getTulipLegacyUid(candidate),
              title: candidate.title || id,
              brand:
                candidate.data?.brand && typeof candidate.data.brand === 'string'
                  ? candidate.data.brand
                  : null,
              model:
                candidate.data?.model && typeof candidate.data.model === 'string'
                  ? candidate.data.model
                  : null,
            };
          })
          .filter(
            (
              candidate,
            ): candidate is {
              id: string;
              uid: string | null;
              title: string;
              brand: string | null;
              model: string | null;
            } => candidate !== null,
          );

        const matchesPayload = (
          candidate: {
            title: string;
            brand: string | null;
            model: string | null;
          },
        ) => {
          if (candidate.title !== payloadTitle) return false;
          if (payloadBrand && candidate.brand !== payloadBrand) return false;
          if (payloadModel && candidate.model !== payloadModel) return false;
          return true;
        };

        const candidatesFromLegacyUid = candidates.filter(
          (candidate) => candidate.uid === mapping.tulipProductId,
        );
        const candidatesFromLegacyUidAndPayload = candidatesFromLegacyUid.filter(matchesPayload);
        const candidatesFromPayload = candidates.filter(matchesPayload);

        const repairedTulipProductId =
          (candidatesFromLegacyUidAndPayload.length === 1
            ? candidatesFromLegacyUidAndPayload[0]?.id
            : null) ??
          (candidatesFromLegacyUid.length === 1
            ? candidatesFromLegacyUid[0]?.id
            : null) ??
          (candidatesFromPayload.length === 1 ? candidatesFromPayload[0]?.id : null);

        if (repairedTulipProductId) {
          await db
            .insert(productsTulip)
            .values({
              id: nanoid(),
              productId: product.id,
              tulipProductId: repairedTulipProductId,
            })
            .onDuplicateKeyUpdate({
              set: {
                tulipProductId: repairedTulipProductId,
              },
            });

          try {
            await tulipUpdateProduct(apiKey, repairedTulipProductId, payload);
          } catch (retryError) {
            if (
              retryError instanceof TulipApiError &&
              getTulipErrorCode(retryError.payload) === 4999
            ) {
              console.warn('[tulip][update-product] repaired mapping still points to missing product; clearing mapping', {
                storeId: store.id,
                productId: product.id,
                repairedTulipProductId,
              });
              await db
                .delete(productsTulip)
                .where(eq(productsTulip.productId, product.id));
              revalidatePath('/dashboard/settings/integrations');
              return { error: 'errors.tulipProductNotMapped' };
            }

            throw retryError;
          }
          revalidatePath('/dashboard/settings/integrations');
        } else {
          console.warn('[tulip][update-product] unable to repair mapping automatically; clearing stale mapping', {
            storeId: store.id,
            productId: product.id,
            mappedTulipProductId: mapping.tulipProductId,
            legacyUidCandidates: candidatesFromLegacyUid.length,
            payloadCandidates: candidatesFromPayload.length,
          });
          await db
            .delete(productsTulip)
            .where(eq(productsTulip.productId, product.id));
          revalidatePath('/dashboard/settings/integrations');
          return { error: 'errors.tulipProductNotMapped' };
        }
      } else {
        throw error;
      }
    }

    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createTulipProductAction(
  input: z.infer<typeof createTulipProductSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = createTulipProductSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const storeSettings = (store.settings as StoreSettings | null) || null;
    const tulipSettings = getTulipSettings(storeSettings);
    console.info('[tulip][create-product] start', {
      storeId: store.id,
      productId: validated.productId,
      hasEncryptedKey: !!tulipSettings.apiKeyEncrypted,
      apiKeyLast4: tulipSettings.apiKeyLast4,
      connectedAt: tulipSettings.connectedAt,
      renterUid: tulipSettings.renterUid,
    });

    let apiKey: string | null = null;
    try {
      apiKey = getTulipApiKey(storeSettings);
    } catch (error) {
      console.error('[tulip][create-product] unable to decrypt api key', {
        storeId: store.id,
        productId: validated.productId,
        error: toErrorMessage(error),
      });
      throw error;
    }
    if (!apiKey) {
      console.warn('[tulip][create-product] api key missing after resolution', {
        storeId: store.id,
        productId: validated.productId,
      });
      return { error: 'errors.tulipNotConfigured' };
    }

    const renterUid = tulipSettings.renterUid?.trim() || null;
    if (!renterUid) {
      console.warn(
        '[tulip][create-product] missing renter uid in tulip settings',
        {
          storeId: store.id,
          productId: validated.productId,
        },
      );
      return { error: 'errors.tulipNotConfigured' };
    }

    console.info('[tulip][create-product] resolved api key', {
      storeId: store.id,
      productId: validated.productId,
      keyLength: apiKey.length,
      keySuffix: apiKey.slice(-4),
    });

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
    });

    if (!product) {
      return { error: 'errors.productNotFound' };
    }

    const existingMapping = await db.query.productsTulip.findFirst({
      where: eq(productsTulip.productId, product.id),
      columns: {
        tulipProductId: true,
      },
    });

    if (existingMapping?.tulipProductId) {
      return { error: 'errors.tulipProductAlreadyMapped' };
    }

    const resolvedProductType: TulipProductTypeValue =
      validated.productType || 'event';
    const resolvedSubtype: TulipProductSubtypeValue =
      validated.productSubtype &&
      isSubtypeAllowedForType(resolvedProductType, validated.productSubtype)
        ? validated.productSubtype
        : getDefaultSubtypeForType(resolvedProductType);

    if (
      validated.productSubtype &&
      resolvedSubtype !== validated.productSubtype
    ) {
      console.warn('[tulip][create-product] subtype incompatible with selected product type, using default subtype', {
        storeId: store.id,
        productId: product.id,
        productType: resolvedProductType,
        requestedSubtype: validated.productSubtype,
        resolvedSubtype,
      });
    }

    const tulipPayload = {
      uid: renterUid,
      product_type: resolvedProductType,
      title: validated.title?.trim() || product.name,
      ...(product.description?.trim()
        ? { description: product.description.trim() }
        : {}),
      data: {
        product_subtype: resolvedSubtype,
        ...(validated.brand?.trim() ? { brand: validated.brand.trim() } : {}),
        ...(validated.model?.trim() ? { model: validated.model.trim() } : {}),
      },
      ...(validated.purchasedDate
        ? { purchased_date: new Date(validated.purchasedDate).toISOString() }
        : {}),
      value_excl: validated.valueExcl ?? Number(product.price),
    };

    console.info('[tulip][create-product] sending create request', {
      storeId: store.id,
      productId: product.id,
      tulipProductType: tulipPayload.product_type,
      tulipProductSubtype: tulipPayload.data.product_subtype,
      hasBrand: !!tulipPayload.data.brand,
      hasModel: !!tulipPayload.data.model,
      hasPurchasedDate: !!tulipPayload.purchased_date,
    });

    let createdProduct: Awaited<ReturnType<typeof tulipCreateProduct>>;
    try {
      createdProduct = await tulipCreateProduct(apiKey, tulipPayload);
    } catch (error) {
      if (error instanceof TulipApiError) {
        console.error('[tulip][create-product] tulip API rejected request', {
          storeId: store.id,
          productId: product.id,
          status: error.status,
          message: error.message,
          payload: error.payload,
        });
      } else {
        console.error('[tulip][create-product] unexpected error', {
          storeId: store.id,
          productId: product.id,
          error: toErrorMessage(error),
        });
      }
      throw error;
    }

    const tulipProductId = String(
      getTulipProductId(createdProduct ?? {}) ?? '',
    ).trim();

    let resolvedTulipProductId = tulipProductId;
    if (!resolvedTulipProductId) {
      const createResponseUid = getTulipLegacyUid(createdProduct ?? {});
      const payloadTitle = tulipPayload.title;
      const payloadBrand = tulipPayload.data.brand ?? null;
      const payloadModel = tulipPayload.data.model ?? null;
      const catalog = await tulipListProducts(apiKey);

      const candidates = catalog
        .map((candidate) => {
          const id = getTulipProductId(candidate);
          if (!id) return null;
          return {
            id,
            uid: getTulipLegacyUid(candidate),
            title: candidate.title || id,
            brand:
              candidate.data?.brand && typeof candidate.data.brand === 'string'
                ? candidate.data.brand
                : null,
            model:
              candidate.data?.model && typeof candidate.data.model === 'string'
                ? candidate.data.model
                : null,
          };
        })
        .filter(
          (
            candidate,
          ): candidate is {
            id: string;
            uid: string | null;
            title: string;
            brand: string | null;
            model: string | null;
          } => candidate !== null,
        )
        .filter((candidate) => {
          if (candidate.title !== payloadTitle) return false;
          if (payloadBrand && candidate.brand !== payloadBrand) return false;
          if (payloadModel && candidate.model !== payloadModel) return false;
          if (createResponseUid && candidate.uid !== createResponseUid) return false;
          return true;
        });

      if (candidates.length === 1) {
        resolvedTulipProductId = candidates[0].id;
      }
    }

    if (!resolvedTulipProductId) {
      console.error('[tulip][create-product] unable to resolve Tulip product_id from create response', {
        storeId: store.id,
        productId: product.id,
        createResponse: createdProduct,
      });
      return { error: 'errors.tulipInvalidProductResponse' };
    }

    await db
      .insert(productsTulip)
        .values({
          id: nanoid(),
          productId: product.id,
          tulipProductId: resolvedTulipProductId,
        })
        .onDuplicateKeyUpdate({
          set: {
            tulipProductId: resolvedTulipProductId,
          },
        });

    revalidatePath('/dashboard/settings/integrations');
    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function disconnectTulipAction(
  input: z.infer<typeof disconnectTulipSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    disconnectTulipSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const currentSettings = (store.settings as StoreSettings | null) || null;
    const nextSettings = mergeTulipSettings(currentSettings, {
      apiKeyEncrypted: undefined,
      apiKeyLast4: undefined,
      connectedAt: undefined,
      renterUid: undefined,
    });

    await db.transaction(async (tx) => {
      await tx
        .update(stores)
        .set({
          settings: nextSettings,
          updatedAt: new Date(),
        })
        .where(eq(stores.id, store.id));

      const storeProducts = await tx.query.products.findMany({
        where: eq(products.storeId, store.id),
        columns: {
          id: true,
        },
      });

      if (storeProducts.length > 0) {
        await tx
          .delete(productsTulip)
          .where(
            inArray(
              productsTulip.productId,
              storeProducts.map((item) => item.id),
            ),
          );
      }
    });

    revalidatePath('/dashboard/settings/integrations');
    revalidatePath('/dashboard/settings/integrations/categories/[category]', 'page');
    revalidatePath('/dashboard/settings/integrations/[integrationId]', 'page');

    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}
