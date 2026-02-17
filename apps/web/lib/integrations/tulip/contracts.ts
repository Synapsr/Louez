import { db, productsTulip, reservations } from '@louez/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { TulipApiError, tulipCreateContract } from './client'
import { getTulipApiKey, getTulipSettings, shouldApplyTulipInsurance } from './settings'

type TulipCustomerInput = {
  customerType?: 'individual' | 'business' | null
  companyName?: string | null
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  postalCode: string
  country?: string | null
}

type TulipItemInput = {
  productId: string
  quantity: number
}

function assertCustomerData(customer: TulipCustomerInput) {
  if (!customer.firstName || !customer.lastName) {
    throw new Error('errors.tulipCustomerDataIncomplete')
  }
  if (!customer.email || !customer.phone) {
    throw new Error('errors.tulipCustomerDataIncomplete')
  }
  if (!customer.address || !customer.city || !customer.postalCode) {
    throw new Error('errors.tulipCustomerDataIncomplete')
  }
}

function buildCustomerPayload(customer: TulipCustomerInput): {
  options: string[]
  company?: Record<string, unknown>
  individual?: Record<string, unknown>
} {
  assertCustomerData(customer)

  const options = ['break', 'theft']
  const baseAddress = {
    address: customer.address,
    city: customer.city,
    zipcode: customer.postalCode,
    country: customer.country || 'FR',
  }

  if (customer.customerType === 'business' && customer.companyName) {
    options.push('company')
    return {
      options,
      company: {
        ...baseAddress,
        company_name: customer.companyName,
        first_name: customer.firstName,
        last_name: customer.lastName,
      },
    }
  }

  options.push('individual')
  return {
    options,
    individual: {
      ...baseAddress,
      first_name: customer.firstName,
      last_name: customer.lastName,
      phone_number: customer.phone,
      email: customer.email,
    },
  }
}

async function getTulipMappingMap(productIds: string[]): Promise<Map<string, string>> {
  if (productIds.length === 0) {
    return new Map()
  }

  const mappings = await db.query.productsTulip.findMany({
    where: inArray(productsTulip.productId, productIds),
  })

  return new Map(mappings.map((mapping) => [mapping.productId, mapping.tulipProductId]))
}

async function buildProductPayload(
  items: TulipItemInput[],
  userName: string,
): Promise<Array<Record<string, unknown>>> {
  const productIds = [...new Set(items.map((item) => item.productId))]
  const mappingMap = await getTulipMappingMap(productIds)

  const productsPayload: Array<Record<string, unknown>> = []
  for (const item of items) {
    const tulipProductId = mappingMap.get(item.productId)
    if (!tulipProductId) {
      throw new Error('errors.tulipProductNotMapped')
    }

    for (let i = 0; i < item.quantity; i++) {
      productsPayload.push({
        product_id: tulipProductId,
        data: {
          user_name: userName,
          internal_id: `${item.productId}-${i + 1}`,
        },
      })
    }
  }

  return productsPayload
}

async function buildContractPayload(params: {
  renterUid: string
  contractType: 'LCD' | 'LMD' | 'LLD'
  startDate: Date
  endDate: Date
  customer: TulipCustomerInput
  items: TulipItemInput[]
}) {
  const userName = `${params.customer.firstName} ${params.customer.lastName}`.trim()
  const productsPayload = await buildProductPayload(params.items, userName)
  const customerPayload = buildCustomerPayload(params.customer)

  return {
    uid: params.renterUid,
    start_date: params.startDate.toISOString(),
    end_date: params.endDate.toISOString(),
    contract_type: params.contractType,
    options: customerPayload.options,
    products: productsPayload,
    ...(customerPayload.company ? { company: customerPayload.company } : {}),
    ...(customerPayload.individual ? { individual: customerPayload.individual } : {}),
  }
}

function toTulipContractError(error: unknown, fallbackKey: string): Error {
  if (error instanceof Error && error.message.startsWith('errors.')) {
    return error
  }

  if (error instanceof TulipApiError) {
    const payload = JSON.stringify(error.payload ?? {}).toLowerCase()
    const message = `${error.message} ${payload}`.toLowerCase()

    if (
      message.includes('past') ||
      message.includes('retro') ||
      message.includes('date')
    ) {
      return new Error('errors.tulipContractPastDate')
    }

    if (
      error.status === 403 ||
      message.includes('forbidden') ||
      message.includes('not allowed') ||
      message.includes('permission')
    ) {
      return new Error('errors.tulipContractActionForbidden')
    }

    if (error.status === 401) {
      return new Error('errors.tulipApiKeyInvalid')
    }

    if (error.status >= 500) {
      return new Error('errors.tulipApiUnavailable')
    }

    return new Error(fallbackKey)
  }

  return new Error(fallbackKey)
}

export async function previewTulipQuoteForCheckout(params: {
  storeId: string
  storeSettings: any
  customer: TulipCustomerInput
  items: TulipItemInput[]
  startDate: Date
  endDate: Date
  optIn: boolean | undefined
}) {
  const tulipSettings = getTulipSettings(params.storeSettings)
  const shouldApply = shouldApplyTulipInsurance(tulipSettings.publicMode, params.optIn)

  if (!shouldApply) {
    return { shouldApply: false as const, amount: 0 }
  }

  const apiKey = getTulipApiKey(params.storeSettings)
  if (!apiKey || !tulipSettings.renterUid) {
    throw new Error('errors.tulipNotConfigured')
  }

  const payload = await buildContractPayload({
    renterUid: tulipSettings.renterUid,
    contractType: tulipSettings.contractType,
    startDate: params.startDate,
    endDate: params.endDate,
    customer: params.customer,
    items: params.items,
  })

  let contract: Awaited<ReturnType<typeof tulipCreateContract>>
  try {
    contract = await tulipCreateContract(apiKey, payload, true)
  } catch (error) {
    throw toTulipContractError(error, 'errors.tulipQuoteFailed')
  }

  return {
    shouldApply: true as const,
    amount: Number(contract.price || 0),
  }
}

export async function createTulipContractForReservation(params: {
  reservationId: string
  force?: boolean
}) {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, params.reservationId),
    with: {
      store: true,
      customer: true,
      items: true,
    },
  })

  if (!reservation) {
    throw new Error('errors.reservationNotFound')
  }

  if (reservation.tulipContractId) {
    return {
      contractId: reservation.tulipContractId,
      created: false,
    }
  }

  if (reservation.tulipContractStatus === 'not_required') {
    return {
      contractId: null,
      created: false,
    }
  }

  const storeSettings = reservation.store.settings as any
  const tulipSettings = getTulipSettings(storeSettings)

  const shouldApply = shouldApplyTulipInsurance(tulipSettings.publicMode, true)
  const canAutoApply = tulipSettings.publicMode !== 'no_public'

  if (!params.force && (!shouldApply || !canAutoApply)) {
    await db
      .update(reservations)
      .set({
        tulipContractStatus: 'not_required',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id))

    return {
      contractId: null,
      created: false,
    }
  }

  const apiKey = getTulipApiKey(storeSettings)
  if (!apiKey || !tulipSettings.renterUid) {
    throw new Error('errors.tulipNotConfigured')
  }

  const insuredItems = reservation.items
    .filter((item) => item.productId && !item.isCustomItem)
    .map((item) => ({
      productId: item.productId!,
      quantity: item.quantity,
    }))

  if (insuredItems.length === 0) {
    await db
      .update(reservations)
      .set({
        tulipContractStatus: 'not_required',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id))

    return {
      contractId: null,
      created: false,
    }
  }

  const payload = await buildContractPayload({
    renterUid: tulipSettings.renterUid,
    contractType: tulipSettings.contractType,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    customer: {
      customerType: reservation.customer.customerType,
      companyName: reservation.customer.companyName,
      firstName: reservation.customer.firstName,
      lastName: reservation.customer.lastName,
      email: reservation.customer.email,
      phone: reservation.customer.phone || '',
      address: reservation.customer.address || '',
      city: reservation.customer.city || '',
      postalCode: reservation.customer.postalCode || '',
      country: reservation.customer.country,
    },
    items: insuredItems,
  })

  let contract: Awaited<ReturnType<typeof tulipCreateContract>>
  try {
    contract = await tulipCreateContract(apiKey, payload, false)
  } catch (error) {
    throw toTulipContractError(error, 'errors.tulipContractCreationFailed')
  }

  const contractId = contract.cid || null

  if (!contractId) {
    throw new Error('errors.tulipInvalidContractResponse')
  }

  await db
    .update(reservations)
    .set({
      tulipContractId: contractId,
      tulipContractStatus: 'created',
      updatedAt: new Date(),
    })
    .where(and(eq(reservations.id, reservation.id), isNull(reservations.tulipContractId)))

  return {
    contractId,
    created: true,
  }
}
