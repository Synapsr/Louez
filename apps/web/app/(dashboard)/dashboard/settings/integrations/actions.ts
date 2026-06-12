'use server';

import { revalidatePath } from 'next/cache';

import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import {
  db,
  integrationCredentials,
  products,
  productsTulip,
  storeIntegrations,
  stores,
} from '@louez/db';
import type { StoreSettings, TulipPublicMode } from '@louez/types';

import {
  getCalendarIntegrationState,
  updateGoogleCalendarSettings,
} from '@/lib/integrations/calendar/state';
import { ICS_CALENDAR_PROVIDER_KEY } from '@/lib/integrations/calendar/state';
import { enqueueCalendarBackfill } from '@/lib/integrations/calendar/sync';
import { GOOGLE_CALENDAR_PROVIDER_KEY } from '@/lib/integrations/providers/google-calendar/google-calendar-client';
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
import {
  TulipApiError,
  type TulipProduct,
  tulipAddRenter,
  tulipCreateProduct,
  tulipGetRenter,
  tulipListProducts,
  tulipListRenters,
  tulipUpdateProduct,
} from '@/lib/integrations/tulip/client';
import { getTulipApiKey } from '@/lib/integrations/tulip/settings';
import {
  TULIP_PROVIDER_KEY,
  resolveTulipIntegrationForStore,
  saveTulipIntegrationForStore,
} from '@/lib/integrations/tulip/state';
import { getCurrentStore } from '@/lib/store-context';
import type { StoreWithFullData } from '@/lib/store-context';

import { env } from '@/env';

type ActionError = {
  error: string;
  details?: string;
};
type TulipCatalogItem = {
  type: string;
  label: string;
  subtypes: Array<{
    type: string;
    label: string;
  }>;
};

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
  'sports',
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
  'other-electronic-equipment',
  'construction-equipment',
  'diy-tools',
  'electric-diy-tools',
  'gardening-tools',
  'electric-gardening-tools',
  'running-hiking',
  'fishing',
  'golf',
  'racket-sports',
  'horseriding',
  'ball-sports',
  'fitness',
  'water-sports',
  'other',
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
const TULIP_LOUEZ_ORIGIN_TAG = '[louez-origin]';
const TULIP_LOUEZ_ORIGIN_FALLBACK_DESCRIPTION = `${TULIP_LOUEZ_ORIGIN_TAG} from Louez`;

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
    'small-appliance',
    'large-appliance',
    'other-electronic-equipment',
  ],
  'small-tools': [
    'construction-equipment',
    'diy-tools',
    'electric-diy-tools',
    'gardening-tools',
    'electric-gardening-tools',
  ],
  sports: [
    'running-hiking',
    'fishing',
    'golf',
    'racket-sports',
    'horseriding',
    'ball-sports',
    'fitness',
    'water-sports',
    'other',
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

function isKnownTulipProductType(
  value: string | null | undefined,
): value is TulipProductTypeValue {
  return (
    typeof value === 'string' &&
    (TULIP_PRODUCT_TYPES as readonly string[]).includes(value)
  );
}

function isKnownTulipProductSubtype(
  value: string | null | undefined,
): value is TulipProductSubtypeValue {
  return (
    typeof value === 'string' &&
    (TULIP_PRODUCT_SUBTYPES as readonly string[]).includes(value)
  );
}

function normalizeTulipOptionalText(
  value: string | null | undefined,
): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function parseTulipMargin(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

type TulipMappingRecord = {
  productId: string;
  tulipProductId: string;
};

async function readTulipMappingsByProductIds(
  productIds: string[],
): Promise<TulipMappingRecord[]> {
  if (productIds.length === 0) {
    return [];
  }

  const mappings = await db.query.productsTulip.findMany({
    where: inArray(productsTulip.productId, productIds),
    columns: {
      productId: true,
      tulipProductId: true,
    },
  });

  return mappings.map((mapping) => ({
    productId: mapping.productId,
    tulipProductId: mapping.tulipProductId,
  }));
}

async function readTulipMappingByProductId(
  productId: string,
): Promise<{ tulipProductId: string } | null> {
  const mappings = await readTulipMappingsByProductIds([productId]);
  const mapping = mappings[0];
  if (!mapping) {
    return null;
  }

  return {
    tulipProductId: mapping.tulipProductId,
  };
}

async function upsertTulipMappingRow(params: {
  productId: string;
  tulipProductId: string;
}) {
  await db
    .insert(productsTulip)
    .values({
      id: nanoid(),
      productId: params.productId,
      tulipProductId: params.tulipProductId,
    })
    .onDuplicateKeyUpdate({
      set: {
        tulipProductId: params.tulipProductId,
      },
    });
}

function toValidIsoDateString(value: string | null | undefined): string | null {
  const normalized = normalizeTulipOptionalText(value);
  if (!normalized) return null;

  const parsedDate = new Date(normalized);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate.toISOString();
}

function isLouezOriginDescription(
  description: string | null | undefined,
): boolean {
  const normalized = normalizeTulipOptionalText(description)?.toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes(TULIP_LOUEZ_ORIGIN_TAG) ||
    normalized.includes('from louez')
  );
}

function buildLouezOriginDescription(
  description: string | null | undefined,
): string {
  const normalized = normalizeTulipOptionalText(description);
  if (!normalized) {
    return TULIP_LOUEZ_ORIGIN_FALLBACK_DESCRIPTION;
  }

  if (isLouezOriginDescription(normalized)) {
    return normalized;
  }

  return `${normalized}\n\n${TULIP_LOUEZ_ORIGIN_FALLBACK_DESCRIPTION}`;
}

function isLouezManagedTulipProduct(product: TulipProduct): boolean {
  return isLouezOriginDescription(product.description);
}

async function resolveCreatedTulipProductId({
  apiKey,
  createdProduct,
  expectedRenterUid,
  expectedLouezProductId,
  expectedTitle,
  expectedBrand,
  expectedModel,
}: {
  apiKey: string;
  createdProduct: TulipProduct | null;
  expectedRenterUid: string;
  expectedLouezProductId: string;
  expectedTitle: string;
  expectedBrand: string | null;
  expectedModel: string | null;
}): Promise<string | null> {
  const directProductId = createdProduct?.id?.trim() || null;
  if (directProductId) {
    return directProductId;
  }

  const normalizedExpectedTitle = expectedTitle.trim();
  if (!normalizedExpectedTitle) {
    return null;
  }

  const catalog = await tulipListProducts(apiKey, {
    renterUid: expectedRenterUid,
  });

  const candidates = catalog
    .map((candidate) => {
      const id = candidate.id?.trim();
      if (!id) return null;
      return {
        id,
        title: candidate.title || id,
        louezProductId: candidate.data?.louezProductId ?? null,
        brand: candidate.data?.brand ?? null,
        model: candidate.data?.model ?? null,
      };
    })
    .filter(
      (
        candidate,
      ): candidate is {
        id: string;
        title: string;
        louezProductId: string | null;
        brand: string | null;
        model: string | null;
      } => candidate !== null,
    )
    .filter((candidate) => {
      if (candidate.louezProductId !== expectedLouezProductId) return false;
      if (candidate.title !== normalizedExpectedTitle) return false;
      if (expectedBrand && candidate.brand !== expectedBrand) return false;
      if (expectedModel && candidate.model !== expectedModel) return false;
      return true;
    });

  return candidates.length === 1 ? candidates[0].id : null;
}

function pickTulipTranslationLabel(
  translations: unknown,
  fallback: string,
): string {
  if (!translations || typeof translations !== 'object') {
    return fallback;
  }

  const record = translations as { fr?: unknown; en?: unknown };
  const fr =
    typeof record.fr === 'string' && record.fr.trim().length > 0
      ? record.fr.trim()
      : null;
  if (fr) return fr;

  const en =
    typeof record.en === 'string' && record.en.trim().length > 0
      ? record.en.trim()
      : null;
  return en || fallback;
}

function normalizeTulipCatalog(rawProducts: unknown): TulipCatalogItem[] {
  if (!Array.isArray(rawProducts)) {
    return [];
  }

  const catalogMap = new Map<string, TulipCatalogItem>();

  for (const product of rawProducts) {
    if (!product || typeof product !== 'object') continue;

    const productRecord = product as {
      product_type?: unknown;
      translations?: unknown;
      product_subtypes?: unknown;
    };
    const type =
      typeof productRecord.product_type === 'string'
        ? productRecord.product_type.trim()
        : '';
    if (!type) continue;

    const current = catalogMap.get(type) ?? {
      type,
      label: pickTulipTranslationLabel(productRecord.translations, type),
      subtypes: [],
    };

    if (Array.isArray(productRecord.product_subtypes)) {
      const subtypeMap = new Map(
        current.subtypes.map((subtype) => [subtype.type, subtype]),
      );

      for (const subtype of productRecord.product_subtypes) {
        if (!subtype || typeof subtype !== 'object') continue;
        const subtypeRecord = subtype as {
          type?: unknown;
          translations?: unknown;
        };
        const subtypeType =
          typeof subtypeRecord.type === 'string'
            ? subtypeRecord.type.trim()
            : '';
        if (!subtypeType) continue;

        subtypeMap.set(subtypeType, {
          type: subtypeType,
          label: pickTulipTranslationLabel(
            subtypeRecord.translations,
            subtypeType,
          ),
        });
      }

      current.subtypes = Array.from(subtypeMap.values()).sort((a, b) =>
        a.label.localeCompare(b.label, 'fr'),
      );
    }

    catalogMap.set(type, current);
  }

  return Array.from(catalogMap.values()).sort((a, b) =>
    a.label.localeCompare(b.label, 'fr'),
  );
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
  enabled: boolean;
  supportsMargin: boolean;
  inclusionEnabled: boolean;
  connectedAt: string | null;
  connectionIssue: string | null;
  calendlyUrl: string;
  settings: {
    publicMode: TulipPublicMode;
    renterUid: string | null;
  };
  renters: Array<{
    uid: string;
    enabled: boolean;
  }>;
  tulipCatalog: TulipCatalogItem[];
  tulipProducts: Array<{
    id: string;
    title: string;
    louezManaged: boolean;
    margin: number | null;
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

export type TulipProductState = {
  connected: boolean;
  supportsMargin: boolean;
  connectedAt: string | null;
  connectionIssue: string | null;
  calendlyUrl: string;
  settings: {
    publicMode: TulipPublicMode;
  };
  tulipCatalog: TulipCatalogItem[];
  tulipProducts: TulipIntegrationState['tulipProducts'];
  product: {
    id: string;
    name: string;
    price: number;
    tulipProductId: string | null;
  };
};

const getTulipProductStateSchema = z.object({
  productId: z.string().length(21),
});

const connectTulipApiKeySchema = z.object({
  renterUid: z.string().trim().min(1).max(120),
});

const updateTulipConfigurationSchema = z.object({
  publicMode: z.enum(['required', 'optional', 'no_public']),
});

const upsertTulipProductMappingSchema = z.object({
  productId: z.string().length(21),
  tulipProductId: z.string().trim().min(1).max(50).nullable(),
});

const pushTulipProductUpdateSchema = z.object({
  productId: z.string().length(21),
  title: z.string().trim().max(255).nullable().optional(),
  productType: z.string().trim().min(1).max(80).nullable().optional(),
  productSubtype: z.string().trim().min(1).max(80).nullable().optional(),
  purchasedDate: tulipPurchasedDateSchema.nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(15_000).nullable().optional(),
  margin: z.number().min(0).max(1_000_000).nullable().optional(),
});

const createTulipProductSchema = z.object({
  productId: z.string().length(21),
  title: z.string().trim().max(255).nullable().optional(),
  productType: z.string().trim().min(1).max(80).nullable().optional(),
  productSubtype: z.string().trim().min(1).max(80).nullable().optional(),
  purchasedDate: tulipPurchasedDateSchema.nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  valueExcl: z.number().min(0).max(15_000).nullable().optional(),
  margin: z.number().min(0).max(1_000_000).nullable().optional(),
});

const disconnectTulipSchema = z.object({});

const updateGoogleCalendarSettingsSchema = z.object({
  syncPendingReservations: z.boolean(),
  cancelledReservationBehavior: z.enum(['show', 'hide']),
});

const disconnectGoogleCalendarSchema = z.object({
  deleteEvents: z.boolean().default(false),
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function redactSensitiveErrorParts(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /(authorization|cookie|password|secret|token|api[_-]?key|client[_-]?secret)(["'\s:=]+)([^"',\s]+)/gi,
      '$1$2[redacted]',
    );
}

function toDebugErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : toErrorMessage(error);
  const redactedMessage = redactSensitiveErrorParts(message);

  return redactedMessage.length > 500
    ? `${redactedMessage.slice(0, 500)}...`
    : redactedMessage;
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

function stringifyTulipPayload(payload: unknown): string | undefined {
  if (payload == null) {
    return undefined;
  }

  if (typeof payload === 'string') {
    return payload.trim() || undefined;
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return undefined;
  }
}

function stringifyTulipErrorPayload(payload: unknown): string | undefined {
  const serialized = stringifyTulipPayload(payload);
  return serialized ? `payload: ${serialized}` : undefined;
}

function toActionError(error: unknown): ActionError {
  if (error instanceof TulipApiError) {
    const payloadDetails = stringifyTulipErrorPayload(error.payload);

    console.error('[tulip] API error', {
      status: error.status,
      message: error.message,
      payload: error.payload,
    });

    if (error.status === 401) {
      return {
        error: 'errors.tulipApiKeyInvalid',
        details: payloadDetails,
      };
    }

    if (error.status === 403) {
      return {
        error: 'errors.tulipActionForbidden',
        details: payloadDetails,
      };
    }

    if (error.status === 400) {
      const code = getTulipErrorCode(error.payload);
      if (code === 4009) {
        return {
          error: 'errors.tulipProductSubtypeInvalid',
          details: payloadDetails,
        };
      }
      if (code === 4005) {
        return {
          error: 'errors.tulipProductPayloadInvalid',
          details: payloadDetails,
        };
      }
      if (code === 4004 || code === 4006 || code === 4007) {
        return {
          error: 'errors.tulipProductRequiredFieldsMissing',
          details: payloadDetails,
        };
      }
      if (code === 4999) {
        return {
          error: 'errors.tulipProductNotFound',
          details: payloadDetails,
        };
      }
    }

    return {
      error: 'errors.tulipApiUnavailable',
      details: payloadDetails,
    };
  }

  if (error instanceof Error && error.message.startsWith('errors.')) {
    return { error: error.message };
  }

  console.error('[integrations] unexpected action error', error);

  if (process.env.NODE_ENV !== 'production') {
    return { error: toDebugErrorMessage(error) };
  }

  return { error: 'errors.generic' };
}

function toTulipRenterAttachError(error: unknown): ActionError {
  if (error instanceof TulipApiError) {
    console.error('[tulip][connect] renter attach failed', {
      status: error.status,
      message: error.message,
      payload: stringifyTulipPayload(error.payload) ?? error.payload,
    });

    if (error.status === 401) {
      return {
        error: 'errors.tulipApiKeyInvalid',
      };
    }

    if (error.status === 403) {
      return {
        error: 'errors.tulipActionForbidden',
      };
    }

    return {
      error: 'errors.tulipRenterAttachFailed',
    };
  }

  return toActionError(error);
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

function userCanManageIntegrations(store: StoreWithFullData): boolean {
  return store.role === 'owner' || store.role === 'platform_admin';
}

async function applyCalendarRuntimeToCatalog(
  store: StoreWithFullData,
  integrations: IntegrationCatalogItem[],
): Promise<IntegrationCatalogItem[]> {
  const calendarState = await getCalendarIntegrationState({
    storeId: store.id,
    icsToken: store.icsToken,
  });

  return integrations.map((integration) => {
    if (integration.id === GOOGLE_CALENDAR_PROVIDER_KEY) {
      return {
        ...integration,
        enabled: calendarState.google.enabled,
        connected: calendarState.google.connected,
        configured: calendarState.google.configured,
        connectionIssue: calendarState.google.lastError,
      };
    }

    if (integration.id === ICS_CALENDAR_PROVIDER_KEY) {
      return {
        ...integration,
        enabled: calendarState.ics.connected,
        connected: calendarState.ics.connected,
        configured: calendarState.ics.connected,
        connectionIssue: null,
      };
    }

    return integration;
  });
}

async function applyTulipRuntimeToCatalog(
  store: StoreWithFullData,
  integrations: IntegrationCatalogItem[],
): Promise<IntegrationCatalogItem[]> {
  if (
    !integrations.some((integration) => integration.id === TULIP_PROVIDER_KEY)
  ) {
    return integrations;
  }

  const resolved = await resolveTulipIntegrationForStore(store.id);

  return integrations.map((integration) => {
    if (integration.id !== TULIP_PROVIDER_KEY) {
      return integration;
    }

    return {
      ...integration,
      enabled: resolved.settings.enabled,
      connected: resolved.connected,
      configured: resolved.connected,
      connectionIssue: resolved.connectionIssue,
    };
  });
}

async function applyRuntimeToCatalog(
  store: StoreWithFullData,
  integrations: IntegrationCatalogItem[],
): Promise<IntegrationCatalogItem[]> {
  const withCalendarRuntime = await applyCalendarRuntimeToCatalog(
    store,
    integrations,
  );
  return applyTulipRuntimeToCatalog(store, withCalendarRuntime);
}

async function applyRuntimeToDetail(
  store: StoreWithFullData,
  integration: IntegrationDetail,
): Promise<IntegrationDetail> {
  const [item] = await applyRuntimeToCatalog(store, [integration]);
  return {
    ...integration,
    ...item,
  };
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

  let mappings: TulipMappingRecord[] = [];

  try {
    mappings = await readTulipMappingsByProductIds(
      storeProducts.map((product) => product.id),
    );
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
    mappings.map((mapping) => [
      mapping.productId,
      {
        tulipProductId: mapping.tulipProductId,
      },
    ]),
  );

  return storeProducts.map((product) => ({
    id: product.id,
    name: product.name,
    price: Number(product.price),
    tulipProductId: mappingByProductId.get(product.id)?.tulipProductId ?? null,
  }));
}

function normalizeTulipProducts(
  rawProducts: Awaited<ReturnType<typeof tulipListProducts>>,
) {
  return rawProducts
    .map((product) => {
      const id = product.id?.trim();
      if (!id) return null;

      return {
        id,
        title: product.title || id,
        louezManaged: isLouezManagedTulipProduct(product),
        margin: parseTulipMargin(product.data?.margin),
        productType: product.productType || null,
        productSubtype: product.data?.productSubtype || null,
        purchasedDate: product.purchasedDate?.trim()
          ? product.purchasedDate
          : null,
        valueExcl:
          typeof product.valueExcl === 'number' &&
          Number.isFinite(product.valueExcl)
            ? product.valueExcl
            : null,
        brand: product.data?.brand ?? null,
        model: product.data?.model ?? null,
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

    const { store } = storeResult;
    const settings = (store.settings as StoreSettings | null) || null;
    const integrations = await applyRuntimeToCatalog(
      store,
      listIntegrations(settings),
    );

    return {
      categories: listCategories(settings),
      integrations,
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

    const { store } = storeResult;
    const settings = (store.settings as StoreSettings | null) || null;
    const categories = listCategories(settings);
    const integrations = await applyRuntimeToCatalog(
      store,
      listByCategory(settings, validated.category),
    );

    if (
      integrations.length === 0 &&
      !categories.some((item) => item.id === validated.category)
    ) {
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

    const { store } = storeResult;
    const settings = (store.settings as StoreSettings | null) || null;
    const integration = getIntegrationDetail(settings, validated.integrationId);

    if (!integration) {
      return { error: 'errors.integrationNotFound' };
    }

    return {
      integration: await applyRuntimeToDetail(store, integration),
    };
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
    if (!userCanManageIntegrations(store)) {
      return { error: 'errors.permissionDenied' };
    }

    const integration = getIntegration(validated.integrationId);
    if (!integration) {
      return { error: 'errors.integrationNotFound' };
    }

    if (validated.integrationId === TULIP_PROVIDER_KEY) {
      const resolved = await resolveTulipIntegrationForStore(store.id);

      if (validated.enabled && !resolved.connected) {
        return { error: 'errors.integrationNotConnected' };
      }

      await saveTulipIntegrationForStore({
        storeId: store.id,
        connectedByUserId: store.userId,
        enabled: validated.enabled,
        status: validated.enabled ? 'active' : 'disabled',
        publicMode: resolved.storedPublicMode,
        renterUid: resolved.settings.renterUid,
        archivedRenterUid: resolved.archivedRenterUid,
        connectedAt: resolved.settings.connectedAt,
      });

      revalidatePath('/dashboard/settings/integrations');
      revalidatePath(
        '/dashboard/settings/integrations/categories/[category]',
        'page',
      );
      revalidatePath(
        '/dashboard/settings/integrations/[integrationId]',
        'page',
      );

      return { success: true };
    }

    if (validated.integrationId === GOOGLE_CALENDAR_PROVIDER_KEY) {
      const existing = await db.query.storeIntegrations.findFirst({
        where: and(
          eq(storeIntegrations.storeId, store.id),
          eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
        ),
      });

      if (!existing) {
        return { error: 'errors.integrationNotConnected' };
      }

      await db
        .update(storeIntegrations)
        .set({
          enabled: validated.enabled,
          status: validated.enabled ? 'active' : 'disabled',
          updatedAt: new Date(),
        })
        .where(eq(storeIntegrations.id, existing.id));

      revalidatePath('/dashboard/settings/integrations');
      revalidatePath(
        '/dashboard/settings/integrations/[integrationId]',
        'page',
      );

      return { success: true };
    }

    if (validated.integrationId === ICS_CALENDAR_PROVIDER_KEY) {
      if (validated.enabled && !store.icsToken) {
        await db
          .update(stores)
          .set({
            icsToken: nanoid(32),
            updatedAt: new Date(),
          })
          .where(eq(stores.id, store.id));
      }

      revalidatePath('/dashboard/settings/integrations');
      revalidatePath(
        '/dashboard/settings/integrations/[integrationId]',
        'page',
      );

      return { success: true };
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
    revalidatePath(
      '/dashboard/settings/integrations/categories/[category]',
      'page',
    );
    revalidatePath('/dashboard/settings/integrations/[integrationId]', 'page');

    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function getCalendarIntegrationStateAction(): Promise<
  Awaited<ReturnType<typeof getCalendarIntegrationState>> | ActionError
> {
  try {
    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    return getCalendarIntegrationState({
      storeId: storeResult.store.id,
      icsToken: storeResult.store.icsToken,
    });
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateGoogleCalendarSettingsAction(
  input: z.infer<typeof updateGoogleCalendarSettingsSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = updateGoogleCalendarSettingsSchema.parse(input);
    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    if (!userCanManageIntegrations(storeResult.store)) {
      return { error: 'errors.permissionDenied' };
    }

    const result = await updateGoogleCalendarSettings({
      storeId: storeResult.store.id,
      syncPendingReservations: validated.syncPendingReservations,
      cancelledReservationBehavior: validated.cancelledReservationBehavior,
    });
    if ('error' in result) return result;

    revalidatePath('/dashboard/settings/integrations/google-calendar');
    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function resyncGoogleCalendarAction(): Promise<
  { success: true; enqueued: number } | ActionError
> {
  try {
    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    if (!userCanManageIntegrations(storeResult.store)) {
      return { error: 'errors.permissionDenied' };
    }

    const integration = await db.query.storeIntegrations.findFirst({
      where: and(
        eq(storeIntegrations.storeId, storeResult.store.id),
        eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
      ),
      with: {
        calendarSettings: true,
      },
    });

    if (!integration?.calendarSettings) {
      return { error: 'errors.integrationNotConnected' };
    }

    const result = await enqueueCalendarBackfill({
      storeId: storeResult.store.id,
      integrationId: integration.id,
      futureMonths: integration.calendarSettings.backfillMonths,
      pastDays: integration.calendarSettings.backfillPastDays,
    });

    await db
      .update(storeIntegrations)
      .set({ status: 'syncing', updatedAt: new Date() })
      .where(eq(storeIntegrations.id, integration.id));

    revalidatePath('/dashboard/settings/integrations/google-calendar');
    return { success: true, enqueued: result.enqueued };
  } catch (error) {
    return toActionError(error);
  }
}

export async function disconnectGoogleCalendarAction(
  input: z.infer<typeof disconnectGoogleCalendarSchema>,
): Promise<{ success: true } | ActionError> {
  try {
    const validated = disconnectGoogleCalendarSchema.parse(input);
    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    if (!userCanManageIntegrations(storeResult.store)) {
      return { error: 'errors.permissionDenied' };
    }

    if (validated.deleteEvents) {
      return { error: 'errors.unsupportedOperation' };
    }

    const integration = await db.query.storeIntegrations.findFirst({
      where: and(
        eq(storeIntegrations.storeId, storeResult.store.id),
        eq(storeIntegrations.providerKey, GOOGLE_CALENDAR_PROVIDER_KEY),
      ),
    });

    if (!integration) {
      return { success: true };
    }

    await db
      .delete(integrationCredentials)
      .where(eq(integrationCredentials.integrationId, integration.id));
    await db
      .update(storeIntegrations)
      .set({
        enabled: false,
        connectedByUserId: null,
        providerAccountEmail: null,
        status: 'disabled',
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(storeIntegrations.id, integration.id));

    revalidatePath('/dashboard/settings/integrations');
    revalidatePath('/dashboard/settings/integrations/google-calendar');
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
    const resolved = await resolveTulipIntegrationForStore(store.id);
    const settings = resolved.settings;

    const productsListPromise = getProductsWithMappings(store.id);

    const renters: TulipIntegrationState['renters'] = [];
    let tulipCatalog: TulipIntegrationState['tulipCatalog'] = [];
    let tulipProducts: TulipIntegrationState['tulipProducts'] = [];
    let connectionIssue: string | null = null;
    let didLoadTulipProducts = false;
    let connected = false;
    let supportsMargin = false;
    let inclusionEnabled = false;

    const apiKey = getTulipApiKey();
    const renterUid = settings.renterUid?.trim() || null;
    if (apiKey && renterUid && settings.enabled) {
      const [renterResult, tulipProductsResult] = await Promise.allSettled([
        tulipGetRenter(apiKey, renterUid),
        tulipListProducts(apiKey, { renterUid }),
      ]);

      if (renterResult.status === 'fulfilled' && renterResult.value?.uid) {
        connected = true;
        supportsMargin = renterResult.value.options?.option === true;
        inclusionEnabled = renterResult.value.options?.inclusion === true;
        tulipCatalog = normalizeTulipCatalog(
          renterResult.value.options?.products,
        );
      } else if (renterResult.status === 'fulfilled') {
        connectionIssue = 'errors.tulipRenterNotFound';
      } else {
        connectionIssue =
          renterResult.reason instanceof TulipApiError &&
          renterResult.reason.status === 404
            ? 'errors.tulipRenterNotFound'
            : toActionError(renterResult.reason).error;
      }

      if (connected && tulipProductsResult.status === 'fulfilled') {
        tulipProducts = normalizeTulipProducts(tulipProductsResult.value);
        didLoadTulipProducts = true;
      } else if (
        connected &&
        tulipProductsResult.status === 'rejected' &&
        !connectionIssue
      ) {
        const productsError = tulipProductsResult.reason;

        console.warn(
          '[tulip] Unable to load Tulip products catalog, continuing without catalog',
          {
            storeId: store.id,
            renterUid,
            status:
              productsError instanceof TulipApiError
                ? productsError.status
                : null,
            payload:
              productsError instanceof TulipApiError
                ? productsError.payload
                : null,
            error:
              productsError instanceof Error
                ? productsError.message
                : productsError,
          },
        );
        if (
          productsError instanceof TulipApiError &&
          (productsError.status === 401 || productsError.status === 403)
        ) {
          connectionIssue = 'errors.tulipProductCatalogUnavailable';
        }
      }
    } else if (renterUid && !apiKey) {
      connectionIssue = 'errors.tulipNotConfigured';
    }

    const rawProducts = await productsListPromise;
    const products = didLoadTulipProducts
      ? (() => {
          const validTulipProductIds = new Set(
            tulipProducts.map((tp) => tp.id),
          );
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
      connected,
      enabled: settings.enabled && connected,
      supportsMargin,
      inclusionEnabled,
      connectedAt: settings.connectedAt,
      connectionIssue,
      calendlyUrl: env.TULIP_CALENDLY_URL || 'https://calendly.com/',
      settings: {
        publicMode: settings.publicMode,
        renterUid: settings.renterUid,
      },
      renters,
      tulipCatalog,
      tulipProducts,
      products,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function getTulipProductStateAction(
  input: z.infer<typeof getTulipProductStateSchema>,
): Promise<TulipProductState | ActionError> {
  try {
    const validated = getTulipProductStateSchema.parse(input);

    const storeResult = await getStoreOrError();
    if ('error' in storeResult) {
      return { error: storeResult.error };
    }

    const { store } = storeResult;
    const resolved = await resolveTulipIntegrationForStore(store.id);
    const settings = resolved.settings;

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

    const mapping = await readTulipMappingByProductId(product.id);

    let tulipCatalog: TulipProductState['tulipCatalog'] = [];
    let tulipProducts: TulipProductState['tulipProducts'] = [];
    let connectionIssue: string | null = null;
    let connected = false;
    let supportsMargin = false;

    const apiKey = getTulipApiKey();
    const renterUid = settings.renterUid?.trim() || null;
    if (apiKey && renterUid && settings.enabled) {
      try {
        const renter = await tulipGetRenter(apiKey, renterUid);
        if (!renter?.uid) {
          connectionIssue = 'errors.tulipRenterNotFound';
        } else {
          connected = true;
          supportsMargin = renter.options?.option === true;
          tulipCatalog = normalizeTulipCatalog(renter.options?.products);
        }
      } catch (error) {
        connectionIssue =
          error instanceof TulipApiError && error.status === 404
            ? 'errors.tulipRenterNotFound'
            : toActionError(error).error;
      }
    } else if (renterUid && !apiKey) {
      connectionIssue = 'errors.tulipNotConfigured';
    }

    if (connected && apiKey && settings.enabled) {
      try {
        const rawProducts = await tulipListProducts(apiKey, { renterUid });
        tulipProducts = normalizeTulipProducts(rawProducts);
      } catch (error) {
        console.warn(
          '[tulip] Unable to load Tulip products catalog for product assurance section',
          {
            storeId: store.id,
            productId: product.id,
            renterUid,
            status: error instanceof TulipApiError ? error.status : null,
            payload: error instanceof TulipApiError ? error.payload : null,
            error: error instanceof Error ? error.message : error,
          },
        );
        if (
          error instanceof TulipApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          connectionIssue = 'errors.tulipProductCatalogUnavailable';
        }
      }
    }

    const mappedTulipProductId = mapping?.tulipProductId ?? null;
    const hasMappedTulipProduct = mappedTulipProductId
      ? tulipProducts.some((item) => item.id === mappedTulipProductId)
      : false;
    const resolvedTulipProductId =
      mappedTulipProductId && tulipProducts.length > 0
        ? hasMappedTulipProduct
          ? mappedTulipProductId
          : null
        : mappedTulipProductId;

    return {
      connected,
      supportsMargin,
      connectedAt: settings.connectedAt,
      connectionIssue,
      calendlyUrl: env.TULIP_CALENDLY_URL || 'https://calendly.com/',
      settings: {
        publicMode: settings.publicMode,
      },
      tulipCatalog,
      tulipProducts,
      product: {
        id: product.id,
        name: product.name,
        price: Number(product.price),
        tulipProductId: resolvedTulipProductId,
      },
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
    if (!userCanManageIntegrations(store)) {
      return { error: 'errors.permissionDenied' };
    }

    const apiKey = getTulipApiKey();
    if (!apiKey) {
      return { error: 'errors.tulipNotConfigured' };
    }

    const renterUid = validated.renterUid.trim();
    if (!renterUid) {
      return { error: 'errors.tulipRenterNotFound' };
    }

    console.info('[tulip][connect] attaching renter uid', {
      storeId: store.id,
      renterUid,
    });

    const renters = await tulipListRenters(apiKey);
    const isRenterAlreadyAttached = renters.some(
      (renter) => renter.uid === renterUid && renter.enabled,
    );

    if (isRenterAlreadyAttached) {
      console.info('[tulip][connect] renter uid already attached', {
        storeId: store.id,
        renterUid,
      });
    } else {
      try {
        await tulipAddRenter(apiKey, renterUid);
      } catch (error) {
        if (
          error instanceof TulipApiError &&
          error.status === 400 &&
          getTulipErrorCode(error.payload) === 2002
        ) {
          console.info('[tulip][connect] renter uid already registered', {
            storeId: store.id,
            renterUid,
          });
        } else {
          return toTulipRenterAttachError(error);
        }
      }
    }

    let renter: Awaited<ReturnType<typeof tulipGetRenter>> = null;
    try {
      renter = await tulipGetRenter(apiKey, renterUid);
    } catch (error) {
      if (error instanceof TulipApiError && error.status === 404) {
        return { error: 'errors.tulipRenterAttachFailed' };
      }

      throw error;
    }
    if (!renter?.uid) {
      return { error: 'errors.tulipRenterAttachFailed' };
    }

    const connectedAt = new Date();
    const resolvedBeforeSave = await resolveTulipIntegrationForStore(store.id);
    await saveTulipIntegrationForStore({
      storeId: store.id,
      connectedByUserId: store.userId,
      enabled: true,
      status: 'active',
      publicMode: resolvedBeforeSave.storedPublicMode,
      renterUid: renter.uid,
      archivedRenterUid: null,
      connectedAt,
    });

    console.info('[tulip][connect] renter saved', {
      storeId: store.id,
      renterUid: renter.uid,
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
    if (!userCanManageIntegrations(store)) {
      return { error: 'errors.permissionDenied' };
    }

    const resolved = await resolveTulipIntegrationForStore(store.id);

    await saveTulipIntegrationForStore({
      storeId: store.id,
      connectedByUserId: store.userId,
      enabled: resolved.settings.enabled,
      status: resolved.settings.enabled ? 'active' : 'disabled',
      publicMode: validated.publicMode,
      renterUid: resolved.settings.renterUid,
      archivedRenterUid: resolved.archivedRenterUid,
      connectedAt: resolved.settings.connectedAt,
    });

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
      columns: {
        id: true,
        name: true,
        price: true,
      },
    });

    if (!product) {
      return { error: 'errors.productNotFound' };
    }

    const existingMapping = await readTulipMappingByProductId(
      validated.productId,
    );
    if (existingMapping?.tulipProductId === validated.tulipProductId) {
      return { success: true };
    }

    if (!validated.tulipProductId) {
      await db
        .delete(productsTulip)
        .where(eq(productsTulip.productId, validated.productId));
    } else {
      const tulipIntegration = await resolveTulipIntegrationForStore(store.id);
      const apiKey = getTulipApiKey();
      const renterUid = tulipIntegration.settings.renterUid?.trim() || null;

      if (!apiKey || !renterUid || !tulipIntegration.settings.enabled) {
        return { error: 'errors.tulipNotConfigured' };
      }

      const tulipCatalog = await tulipListProducts(apiKey, { renterUid });
      const selectedTulipProduct =
        tulipCatalog.find(
          (candidate) => candidate.id === validated.tulipProductId,
        ) ?? null;

      if (!selectedTulipProduct) {
        return { error: 'errors.tulipProductNotFound' };
      }

      let resolvedTulipProductId = validated.tulipProductId;

      if (!isLouezManagedTulipProduct(selectedTulipProduct)) {
        const resolvedProductType =
          normalizeTulipOptionalText(selectedTulipProduct.productType) ||
          'event';
        const selectedSubtype = normalizeTulipOptionalText(
          selectedTulipProduct.data?.productSubtype,
        );
        let resolvedSubtype = selectedSubtype;
        if (!resolvedSubtype && isKnownTulipProductType(resolvedProductType)) {
          resolvedSubtype = getDefaultSubtypeForType(resolvedProductType);
        } else if (
          resolvedSubtype &&
          isKnownTulipProductType(resolvedProductType) &&
          isKnownTulipProductSubtype(resolvedSubtype) &&
          !isSubtypeAllowedForType(resolvedProductType, resolvedSubtype)
        ) {
          resolvedSubtype = getDefaultSubtypeForType(resolvedProductType);
        }
        if (!resolvedSubtype) {
          return { error: 'errors.tulipProductSubtypeInvalid' };
        }
        const selectedBrand = normalizeTulipOptionalText(
          selectedTulipProduct.data?.brand,
        );
        const selectedModel = normalizeTulipOptionalText(
          selectedTulipProduct.data?.model,
        );
        const selectedMargin = parseTulipMargin(
          selectedTulipProduct.data?.margin,
        );
        const selectedTitle =
          normalizeTulipOptionalText(selectedTulipProduct.title) ??
          product.name;
        const selectedPurchasedDate = toValidIsoDateString(
          selectedTulipProduct.purchasedDate,
        );

        const clonePayload = {
          uid: renterUid,
          product_type: resolvedProductType,
          title: selectedTitle,
          description: buildLouezOriginDescription(
            selectedTulipProduct.description,
          ),
          data: {
            product_subtype: resolvedSubtype,
            ...(selectedBrand ? { brand: selectedBrand } : {}),
            ...(selectedModel ? { model: selectedModel } : {}),
            ...(selectedMargin != null ? { margin: selectedMargin } : {}),
            louez_product_ID: product.id,
          },
          ...(selectedPurchasedDate
            ? { purchased_date: selectedPurchasedDate }
            : {}),
          value_excl:
            typeof selectedTulipProduct.valueExcl === 'number' &&
            Number.isFinite(selectedTulipProduct.valueExcl)
              ? selectedTulipProduct.valueExcl
              : Number(product.price),
        };

        const createdClone = await tulipCreateProduct(apiKey, clonePayload);
        const clonedProductId = await resolveCreatedTulipProductId({
          apiKey,
          createdProduct: createdClone,
          expectedRenterUid: renterUid,
          expectedLouezProductId: product.id,
          expectedTitle: selectedTitle,
          expectedBrand: selectedBrand,
          expectedModel: selectedModel,
        });

        if (!clonedProductId) {
          return { error: 'errors.tulipInvalidProductResponse' };
        }

        resolvedTulipProductId = clonedProductId;
      }

      await upsertTulipMappingRow({
        productId: validated.productId,
        tulipProductId: resolvedTulipProductId,
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
    const tulipIntegration = await resolveTulipIntegrationForStore(store.id);
    const apiKey = getTulipApiKey();
    if (!apiKey) {
      return { error: 'errors.tulipNotConfigured' };
    }
    const renterUid = tulipIntegration.settings.renterUid?.trim() || null;
    if (!renterUid || !tulipIntegration.settings.enabled) {
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

    const mapping = await readTulipMappingByProductId(product.id);

    if (!mapping?.tulipProductId) {
      return { error: 'errors.tulipProductNotMapped' };
    }
    let resolvedTulipProductId = mapping.tulipProductId;

    const title = validated.title?.trim() || null;
    const payload: Record<string, unknown> = {
      title: title || product.name,
      value_excl: validated.valueExcl ?? Number(product.price),
    };
    const productType = normalizeTulipOptionalText(validated.productType);
    let resolvedSubtype = normalizeTulipOptionalText(validated.productSubtype);
    if (productType) {
      payload.product_type = productType;
      if (!resolvedSubtype && isKnownTulipProductType(productType)) {
        resolvedSubtype = getDefaultSubtypeForType(productType);
      } else if (
        resolvedSubtype &&
        isKnownTulipProductType(productType) &&
        isKnownTulipProductSubtype(resolvedSubtype) &&
        !isSubtypeAllowedForType(productType, resolvedSubtype)
      ) {
        console.warn(
          '[tulip][update-product] subtype incompatible with selected product type, using default subtype',
          {
            storeId: store.id,
            productId: product.id,
            productType,
            requestedSubtype: resolvedSubtype,
          },
        );
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
      await tulipUpdateProduct(apiKey, resolvedTulipProductId, payload);
    } catch (error) {
      if (
        error instanceof TulipApiError &&
        getTulipErrorCode(error.payload) === 4999
      ) {
        console.warn(
          '[tulip][update-product] mapped Tulip product not found, attempting mapping repair',
          {
            storeId: store.id,
            productId: product.id,
            mappedTulipProductId: resolvedTulipProductId,
          },
        );

        const rawCatalog = await tulipListProducts(apiKey, { renterUid });
        const payloadTitle =
          typeof payload.title === 'string' ? payload.title : product.name;
        const payloadData =
          payload.data && typeof payload.data === 'object'
            ? (payload.data as { brand?: string; model?: string })
            : {};
        const payloadBrand =
          typeof payloadData.brand === 'string' ? payloadData.brand : null;
        const payloadModel =
          typeof payloadData.model === 'string' ? payloadData.model : null;

        const candidates = rawCatalog
          .map((candidate) => {
            const id = candidate.id?.trim();
            if (!id) return null;

            return {
              id,
              title: candidate.title || id,
              louezProductId: candidate.data?.louezProductId ?? null,
              brand: candidate.data?.brand ?? null,
              model: candidate.data?.model ?? null,
            };
          })
          .filter(
            (
              candidate,
            ): candidate is {
              id: string;
              title: string;
              louezProductId: string | null;
              brand: string | null;
              model: string | null;
            } => candidate !== null,
          );

        const matchesPayload = (candidate: {
          title: string;
          brand: string | null;
          model: string | null;
        }) => {
          if (candidate.title !== payloadTitle) return false;
          if (payloadBrand && candidate.brand !== payloadBrand) return false;
          if (payloadModel && candidate.model !== payloadModel) return false;
          return true;
        };

        const candidatesFromLouezProductId = candidates.filter(
          (candidate) => candidate.louezProductId === product.id,
        );
        const candidatesFromLouezProductIdAndPayload =
          candidatesFromLouezProductId.filter(matchesPayload);
        const candidatesFromPayload = candidates.filter(matchesPayload);

        const repairedTulipProductId =
          (candidatesFromLouezProductIdAndPayload.length === 1
            ? candidatesFromLouezProductIdAndPayload[0]?.id
            : null) ??
          (candidatesFromLouezProductId.length === 1
            ? candidatesFromLouezProductId[0]?.id
            : null) ??
          (candidatesFromPayload.length === 1
            ? candidatesFromPayload[0]?.id
            : null);

        if (repairedTulipProductId) {
          resolvedTulipProductId = repairedTulipProductId;
          await upsertTulipMappingRow({
            productId: product.id,
            tulipProductId: resolvedTulipProductId,
          });

          try {
            await tulipUpdateProduct(apiKey, resolvedTulipProductId, payload);
          } catch (retryError) {
            if (
              retryError instanceof TulipApiError &&
              getTulipErrorCode(retryError.payload) === 4999
            ) {
              console.warn(
                '[tulip][update-product] repaired mapping still points to missing product; clearing mapping',
                {
                  storeId: store.id,
                  productId: product.id,
                  repairedTulipProductId: resolvedTulipProductId,
                },
              );
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
          console.warn(
            '[tulip][update-product] unable to repair mapping automatically; clearing stale mapping',
            {
              storeId: store.id,
              productId: product.id,
              mappedTulipProductId: resolvedTulipProductId,
              louezProductIdCandidates: candidatesFromLouezProductId.length,
              payloadCandidates: candidatesFromPayload.length,
            },
          );
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
    const tulipSettings = (await resolveTulipIntegrationForStore(store.id))
      .settings;
    console.info('[tulip][create-product] start', {
      storeId: store.id,
      productId: validated.productId,
      hasApiKey: !!getTulipApiKey(),
      connectedAt: tulipSettings.connectedAt,
      renterUid: tulipSettings.renterUid,
    });

    const apiKey = getTulipApiKey();
    if (!apiKey) {
      console.warn('[tulip][create-product] api key missing after resolution', {
        storeId: store.id,
        productId: validated.productId,
      });
      return { error: 'errors.tulipNotConfigured' };
    }

    const renterUid = tulipSettings.renterUid?.trim() || null;
    if (!renterUid || !tulipSettings.enabled) {
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

    const requestedProductType = normalizeTulipOptionalText(
      validated.productType,
    );
    const requestedSubtype = normalizeTulipOptionalText(
      validated.productSubtype,
    );
    const resolvedBrand = validated.brand?.trim() || null;
    const resolvedModel = validated.model?.trim() || null;
    const resolvedValueExcl = validated.valueExcl ?? null;

    if (
      !requestedProductType ||
      !requestedSubtype ||
      !resolvedBrand ||
      !resolvedModel ||
      resolvedValueExcl == null
    ) {
      return { error: 'errors.tulipProductRequiredFieldsMissing' };
    }

    const resolvedProductType = requestedProductType;
    let resolvedSubtype = requestedSubtype;

    if (!resolvedSubtype && isKnownTulipProductType(resolvedProductType)) {
      resolvedSubtype = getDefaultSubtypeForType(resolvedProductType);
    } else if (
      resolvedSubtype &&
      isKnownTulipProductType(resolvedProductType) &&
      isKnownTulipProductSubtype(resolvedSubtype) &&
      !isSubtypeAllowedForType(resolvedProductType, resolvedSubtype)
    ) {
      console.warn(
        '[tulip][create-product] subtype incompatible with selected product type, using default subtype',
        {
          storeId: store.id,
          productId: product.id,
          productType: resolvedProductType,
          requestedSubtype,
        },
      );
      resolvedSubtype = getDefaultSubtypeForType(resolvedProductType);
    }

    if (!resolvedSubtype) {
      return { error: 'errors.tulipProductSubtypeInvalid' };
    }

    const resolvedTitle = validated.title?.trim() || product.name;
    const resolvedMargin = validated.margin ?? null;
    const resolvedPurchasedDate = validated.purchasedDate
      ? new Date(validated.purchasedDate).toISOString()
      : null;

    const tulipPayload = {
      uid: renterUid,
      product_type: resolvedProductType,
      title: resolvedTitle,
      description: buildLouezOriginDescription(product.description),
      data: {
        product_subtype: resolvedSubtype,
        ...(resolvedBrand ? { brand: resolvedBrand } : {}),
        ...(resolvedModel ? { model: resolvedModel } : {}),
        ...(resolvedMargin != null ? { margin: resolvedMargin } : {}),
        louez_product_ID: product.id,
      },
      ...(resolvedPurchasedDate
        ? { purchased_date: resolvedPurchasedDate }
        : {}),
      value_excl: resolvedValueExcl,
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

    const resolvedTulipProductId = await resolveCreatedTulipProductId({
      apiKey,
      createdProduct,
      expectedRenterUid: renterUid,
      expectedLouezProductId: product.id,
      expectedTitle: resolvedTitle,
      expectedBrand: resolvedBrand,
      expectedModel: resolvedModel,
    });

    if (!resolvedTulipProductId) {
      console.error(
        '[tulip][create-product] unable to resolve Tulip product id from create response',
        {
          storeId: store.id,
          productId: product.id,
          createResponse: createdProduct,
        },
      );
      return { error: 'errors.tulipInvalidProductResponse' };
    }

    await upsertTulipMappingRow({
      productId: product.id,
      tulipProductId: resolvedTulipProductId,
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
    if (!userCanManageIntegrations(store)) {
      return { error: 'errors.permissionDenied' };
    }

    const resolved = await resolveTulipIntegrationForStore(store.id);
    const activeRenterUid = resolved.settings.renterUid?.trim() || null;
    await saveTulipIntegrationForStore({
      storeId: store.id,
      connectedByUserId: null,
      enabled: false,
      status: 'disabled',
      publicMode: resolved.storedPublicMode,
      renterUid: null,
      archivedRenterUid: activeRenterUid || resolved.archivedRenterUid,
      connectedAt: null,
    });

    await db.transaction(async (tx) => {
      const storeProducts = await tx.query.products.findMany({
        where: eq(products.storeId, store.id),
        columns: {
          id: true,
        },
      });

      if (storeProducts.length > 0) {
        await tx.delete(productsTulip).where(
          inArray(
            productsTulip.productId,
            storeProducts.map((item) => item.id),
          ),
        );
      }
    });

    revalidatePath('/dashboard/settings/integrations');
    revalidatePath(
      '/dashboard/settings/integrations/categories/[category]',
      'page',
    );
    revalidatePath('/dashboard/settings/integrations/[integrationId]', 'page');

    return { success: true };
  } catch (error) {
    return toActionError(error);
  }
}
