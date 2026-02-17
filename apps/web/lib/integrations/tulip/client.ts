import { env } from '@/env'

type TulipRecord = Record<string, unknown>

export class TulipApiError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

function unwrapEnvelope(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload[0] ?? null
  }
  return payload
}

function extractMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'Unknown error'
  }
  const obj = payload as TulipRecord
  if (typeof obj.message === 'string') return obj.message
  if (obj.error && typeof obj.error === 'object') {
    const errorObj = obj.error as TulipRecord
    if (typeof errorObj.message === 'string') return errorObj.message
  }
  return 'Unknown error'
}

async function request<T>(
  path: string,
  apiKey: string,
  options?: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    body?: unknown
  },
): Promise<T> {
  const method = options?.method || 'GET'
  const hasBody = options?.body !== undefined

  const response = await fetch(`${env.TULIP_API_BASE_URL}${path}`, {
    method,
    headers: {
      key: apiKey,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    body: hasBody ? JSON.stringify(options?.body) : undefined,
    cache: 'no-store',
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new TulipApiError(
      `Tulip API request failed (${response.status}): ${extractMessage(payload)}`,
      response.status,
      payload,
    )
  }

  return payload as T
}

export type TulipProduct = {
  uid?: string
  product_id?: string
  title?: string
  product_type?: string
  data?: {
    product_subtype?: string
    brand?: string
    model?: string
  }
  value_excl?: number
}

export type TulipRenter = {
  uid: string
  enabled: boolean
}

export type TulipRenterDetails = {
  uid: string
  options?: {
    option?: boolean
    inclusion?: boolean
    LCD?: boolean
    LMD?: boolean
    LLD?: boolean
  }
}

export async function tulipListRenters(apiKey: string): Promise<TulipRenter[]> {
  const payload = await request<unknown>('/renters', apiKey)
  const envelope = unwrapEnvelope(payload) as TulipRecord | null
  const renters = envelope?.renters

  if (!renters || typeof renters !== 'object') {
    return []
  }

  return Object.entries(renters as Record<string, unknown>).map(([uid, enabled]) => ({
    uid,
    enabled: Boolean(enabled),
  }))
}

export async function tulipGetRenter(apiKey: string, renterUid: string): Promise<TulipRenterDetails | null> {
  const payload = await request<unknown>(`/renters/${renterUid}`, apiKey)
  const envelope = unwrapEnvelope(payload) as TulipRecord | null
  const renter = envelope?.renter

  if (!renter || typeof renter !== 'object') {
    return null
  }

  const renterObj = renter as TulipRecord
  return {
    uid: String(renterObj.uid ?? renterUid),
    options: (renterObj.options as TulipRenterDetails['options']) ?? undefined,
  }
}

export async function tulipListProducts(apiKey: string): Promise<TulipProduct[]> {
  const payload = await request<unknown>('/products', apiKey)
  const envelope = unwrapEnvelope(payload)

  if (Array.isArray(envelope)) {
    return envelope as TulipProduct[]
  }

  if (envelope && typeof envelope === 'object') {
    const obj = envelope as TulipRecord
    if (Array.isArray(obj.products)) {
      return obj.products as TulipProduct[]
    }
  }

  return []
}

export async function tulipCreateProduct(
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<TulipProduct | null> {
  const response = await request<unknown>('/products', apiKey, {
    method: 'POST',
    body: payload,
  })
  const envelope = unwrapEnvelope(response)

  if (envelope && typeof envelope === 'object') {
    const obj = envelope as TulipRecord
    if (obj.product && typeof obj.product === 'object') {
      return obj.product as TulipProduct
    }

    if (obj.uid || obj.product_id) {
      return obj as TulipProduct
    }
  }

  return null
}

export async function tulipUpdateProduct(
  apiKey: string,
  tulipProductId: string,
  payload: Record<string, unknown>,
): Promise<TulipProduct | null> {
  const response = await request<unknown>(`/products/${tulipProductId}`, apiKey, {
    method: 'PATCH',
    body: payload,
  })
  const envelope = unwrapEnvelope(response)

  if (envelope && typeof envelope === 'object') {
    const obj = envelope as TulipRecord
    if (obj.product && typeof obj.product === 'object') {
      return obj.product as TulipProduct
    }
  }

  return null
}

type TulipContract = {
  cid?: string
  price?: number
}

export async function tulipCreateContract(
  apiKey: string,
  payload: Record<string, unknown>,
  preview: boolean,
): Promise<TulipContract> {
  const query = preview ? '?preview=true' : ''
  const response = await request<unknown>(`/contracts${query}`, apiKey, {
    method: 'POST',
    body: payload,
  })
  const envelope = unwrapEnvelope(response) as TulipRecord | null
  const contract = envelope?.contract
  if (!contract || typeof contract !== 'object') {
    throw new Error('errors.tulipInvalidContractResponse')
  }
  return contract as TulipContract
}
