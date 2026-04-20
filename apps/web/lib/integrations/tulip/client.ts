import { env } from '@/env';

type TulipRecord = Record<string, unknown>;
const TULIP_API_TIMEOUT_MS = 20_000;

export class TulipApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function unwrapEnvelope(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }
  return payload;
}

function extractMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'Unknown error';
  }
  const obj = payload as TulipRecord;
  if (typeof obj.message === 'string') return obj.message;
  if (obj.error && typeof obj.error === 'object') {
    const errorObj = obj.error as TulipRecord;
    if (typeof errorObj.message === 'string') return errorObj.message;
  }
  return 'Unknown error';
}

async function request<T>(
  path: string,
  apiKey: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
  },
): Promise<T> {
  const method = options?.method || 'GET';
  const hasBody = options?.body !== undefined;

  const url = `${env.TULIP_API_BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TULIP_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        key: apiKey,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? JSON.stringify(options?.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new TulipApiError(
        `Tulip API request timed out after ${TULIP_API_TIMEOUT_MS}ms`,
        504,
        { message: 'Request timed out' },
      );
    }

    throw new TulipApiError(
      error instanceof Error
        ? `Tulip API request failed: ${error.message}`
        : 'Tulip API request failed',
      503,
      {
        message: error instanceof Error ? error.message : 'Network error',
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new TulipApiError(
      `Tulip API request failed (${response.status}): ${extractMessage(payload)}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export type TulipProduct = {
  id: string;
  title?: string;
  description?: string;
  productType?: string;
  purchasedDate?: string;
  data?: {
    productSubtype?: string;
    brand?: string;
    model?: string;
    margin?: number | string | null;
    louezProductId?: string | null;
  };
  valueExcl?: number;
};

function parseTulipProduct(payload: unknown): TulipProduct | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as TulipRecord;
  const id =
    typeof record.product_id === 'string'
      ? record.product_id.trim()
      : typeof record.uid === 'string'
        ? record.uid.trim()
        : '';

  if (!id) {
    return null;
  }

  const data =
    record.data && typeof record.data === 'object'
      ? (record.data as TulipRecord)
      : null;
  const rawMargin = data?.margin;
  const margin =
    typeof rawMargin === 'number' || typeof rawMargin === 'string'
      ? rawMargin
      : null;

  return {
    id,
    title: typeof record.title === 'string' ? record.title : undefined,
    description:
      typeof record.description === 'string' ? record.description : undefined,
    productType:
      typeof record.product_type === 'string' ? record.product_type : undefined,
    purchasedDate:
      typeof record.purchased_date === 'string'
        ? record.purchased_date
        : undefined,
    data: data
      ? {
          productSubtype:
            typeof data.product_subtype === 'string'
              ? data.product_subtype
              : undefined,
          brand: typeof data.brand === 'string' ? data.brand : undefined,
          model: typeof data.model === 'string' ? data.model : undefined,
          margin,
          louezProductId:
            typeof data.louez_product_ID === 'string'
              ? data.louez_product_ID
              : null,
        }
      : undefined,
    valueExcl:
      typeof record.value_excl === 'number' && Number.isFinite(record.value_excl)
        ? record.value_excl
        : undefined,
  };
}

export type TulipRenter = {
  uid: string;
  enabled: boolean;
};

export type TulipRenterDetails = {
  uid: string;
  options?: {
    option?: boolean;
    inclusion?: boolean;
    LCD?: boolean;
    LMD?: boolean;
    LLD?: boolean;
    products?: Array<{
      product_type?: string;
      translations?: {
        en?: string;
        fr?: string;
      };
      product_subtypes?: Array<{
        type?: string;
        translations?: {
          en?: string;
          fr?: string;
        };
      }>;
    }>;
  };
};

export async function tulipListRenters(apiKey: string): Promise<TulipRenter[]> {
  const payload = await request<unknown>('/renters', apiKey);
  const envelope = unwrapEnvelope(payload) as TulipRecord | null;
  const renters = envelope?.renters;

  if (!renters || typeof renters !== 'object') {
    return [];
  }

  return Object.entries(renters as Record<string, unknown>).map(
    ([uid, enabled]) => ({
      uid,
      enabled: Boolean(enabled),
    }),
  );
}

export async function tulipGetRenter(
  apiKey: string,
  renterUid: string,
): Promise<TulipRenterDetails | null> {
  const payload = await request<unknown>(`/renters/${renterUid}`, apiKey);
  const envelope = unwrapEnvelope(payload) as TulipRecord | null;
  const renter = envelope?.renter;

  if (!renter || typeof renter !== 'object') {
    return null;
  }

  const renterObj = renter as TulipRecord;
  return {
    uid: String(renterObj.uid ?? renterUid),
    options: (renterObj.options as TulipRenterDetails['options']) ?? undefined,
  };
}

export async function tulipAddRenter(
  apiKey: string,
  renterUid: string,
): Promise<void> {
  await request<unknown>('/renters', apiKey, {
    method: 'POST',
    body: renterUid,
  });
}

export async function tulipListProducts(
  apiKey: string,
): Promise<TulipProduct[]> {
  const payload = await request<unknown>('/products', apiKey);
  const envelope = unwrapEnvelope(payload);
  let productsPayload: unknown[] = [];

  if (Array.isArray(envelope)) {
    productsPayload = envelope;
  }

  if (productsPayload.length === 0 && envelope && typeof envelope === 'object') {
    const obj = envelope as TulipRecord;
    if (Array.isArray(obj.products)) {
      productsPayload = obj.products;
    }
  }

  return productsPayload
    .map((product) => parseTulipProduct(product))
    .filter((product): product is TulipProduct => product !== null);
}

export async function tulipCreateProduct(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<TulipProduct | null> {
  const response = await request<unknown>('/products', apiKey, {
    method: 'POST',
    body: payload,
  });
  const envelope = unwrapEnvelope(response);

  if (envelope && typeof envelope === 'object') {
    const obj = envelope as TulipRecord;
    if (obj.product && typeof obj.product === 'object') {
      return parseTulipProduct(obj.product);
    }

    return parseTulipProduct(obj);
  }

  return null;
}

export async function tulipUpdateProduct(
  apiKey: string,
  tulipProductId: string,
  payload: Record<string, unknown>,
): Promise<TulipProduct | null> {
  const response = await request<unknown>(
    `/products/${tulipProductId}`,
    apiKey,
    {
      method: 'PATCH',
      body: payload,
    },
  );
  const envelope = unwrapEnvelope(response);

  if (envelope && typeof envelope === 'object') {
    const obj = envelope as TulipRecord;
    if (obj.product && typeof obj.product === 'object') {
      return parseTulipProduct(obj.product);
    }
  }

  return null;
}

export type TulipContract = {
  cid?: string;
  price?: number;
  start_date?: string;
  end_date?: string;
  status?: string;
  contract_type?: string;
  options?: string[];
  company?: Record<string, unknown>;
  individual?: Record<string, unknown>;
  products?: Record<string, TulipContractProduct>;
};

export type TulipContractProduct = {
  product_id?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  data?: {
    user_name?: string;
    product_marked?: string;
    louez_product_ID?: string;
    internal_id?: string;
  };
  price?: number;
  replaced_by?: string;
};

function parseContractResponse(envelope: unknown): TulipContract {
  const contractEnvelope = envelope as TulipRecord | null;
  const contract = contractEnvelope?.contract;
  if (!contract || typeof contract !== 'object') {
    throw new Error('errors.tulipInvalidContractResponse');
  }

  return contract as TulipContract;
}

export async function tulipCreateContract(
  apiKey: string,
  payload: Record<string, unknown>,
  preview: boolean,
): Promise<TulipContract> {
  const query = preview ? '?preview=true' : '';
  const response = await request<unknown>(`/contracts${query}`, apiKey, {
    method: 'POST',
    body: payload,
  });
  return parseContractResponse(unwrapEnvelope(response));
}

export async function tulipGetContract(
  apiKey: string,
  contractId: string,
): Promise<TulipContract> {
  const response = await request<unknown>(`/contracts/${contractId}`, apiKey);
  return parseContractResponse(unwrapEnvelope(response));
}

export async function tulipUpdateContract(
  apiKey: string,
  contractId: string,
  payload: Record<string, unknown>,
  preview: boolean,
): Promise<TulipContract> {
  const query = preview ? '?preview=true' : '';
  const response = await request<unknown>(
    `/contracts/${contractId}${query}`,
    apiKey,
    {
      method: 'PATCH',
      body: payload,
    },
  );

  return parseContractResponse(unwrapEnvelope(response));
}

export async function tulipAddProductsToContract(
  apiKey: string,
  contractId: string,
  payload: Record<string, unknown>,
  preview: boolean,
): Promise<TulipContract> {
  const query = preview ? '?preview=true' : '';
  const response = await request<unknown>(
    `/contracts/${contractId}/products${query}`,
    apiKey,
    {
      method: 'POST',
      body: payload,
    },
  );

  return parseContractResponse(unwrapEnvelope(response));
}

export async function tulipDeleteProductsFromContract(
  apiKey: string,
  contractId: string,
  payload: Record<string, unknown>,
  preview: boolean,
): Promise<TulipContract> {
  const query = preview ? '?preview=true' : '';
  const response = await request<unknown>(
    `/contracts/${contractId}/products${query}`,
    apiKey,
    {
      method: 'DELETE',
      body: payload,
    },
  );

  return parseContractResponse(unwrapEnvelope(response));
}

export async function tulipCancelContract(
  apiKey: string,
  contractId: string,
  payload: Record<string, unknown>,
  preview: boolean,
): Promise<TulipContract> {
  const query = preview ? '?preview=true' : '';
  const response = await request<unknown>(
    `/contracts/${contractId}${query}`,
    apiKey,
    {
      method: 'DELETE',
      body: payload,
    },
  );

  return parseContractResponse(unwrapEnvelope(response));
}
