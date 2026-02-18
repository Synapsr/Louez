import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db, productsTulip, reservations } from '@louez/db'

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

type ResolvedTulipItemInput = {
  productId: string
  tulipProductId: string
  quantity: number
}

export type TulipCoverageSummary = {
  insuredProductCount: number
  uninsuredProductCount: number
  insuredProductIds: string[]
}

export type TulipQuotePreviewResult = {
  shouldApply: boolean
  amount: number
  insuredProductCount: number
  uninsuredProductCount: number
  insuredProductIds: string[]
}

const LEGACY_INSURANCE_LABELS = ['garantie casse/vol', 'breakage/theft coverage']
const IS_TULIP_TEST_CONTRACT = process.env.NODE_ENV !== 'production'

function getTulipErrorCode(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const nestedError = (payload as { error?: unknown }).error
  if (!nestedError || typeof nestedError !== 'object') {
    return null
  }

  const code = (nestedError as { code?: unknown }).code
  return typeof code === 'number' ? code : null
}

function requiresContractIdentityOption(params: {
  contractType: 'LCD' | 'LMD' | 'LLD'
  startDate: Date
  endDate: Date
}): boolean {
  if (params.contractType === 'LLD') {
    return true
  }

  if (params.contractType !== 'LMD') {
    return false
  }

  const thresholdDate = new Date(params.startDate)
  thresholdDate.setMonth(thresholdDate.getMonth() + 5)
  return params.endDate > thresholdDate
}

function assertCustomerData(
  customer: TulipCustomerInput,
  requireIdentityOption: boolean,
) {
  if (!customer.firstName || !customer.lastName) {
    throw new Error('errors.tulipCustomerDataIncomplete')
  }
  if (!customer.email || !customer.phone) {
    throw new Error('errors.tulipCustomerDataIncomplete')
  }
  if (
    requireIdentityOption &&
    (!customer.address || !customer.city || !customer.postalCode)
  ) {
    throw new Error('errors.tulipCustomerDataIncomplete')
  }
}

function buildCustomerPayload(
  customer: TulipCustomerInput,
  requireIdentityOption: boolean,
): {
  options: string[]
  company?: Record<string, unknown>
  individual?: Record<string, unknown>
} {
  assertCustomerData(customer, requireIdentityOption)

  const options = ['break', 'theft']
  const baseAddress = {
    address: customer.address,
    city: customer.city,
    zipcode: customer.postalCode,
    country: customer.country || 'FR',
  }

  if (customer.customerType === 'business' && customer.companyName) {
    if (requireIdentityOption) {
      options.push('company')
    }

    return {
      options,
      ...(requireIdentityOption
        ? {
            company: {
              ...baseAddress,
              company_name: customer.companyName,
              first_name: customer.firstName,
              last_name: customer.lastName,
            },
          }
        : {}),
    }
  }

  if (requireIdentityOption) {
    options.push('individual')
  }

  return {
    options,
    ...(requireIdentityOption
      ? {
          individual: {
            ...baseAddress,
            first_name: customer.firstName,
            last_name: customer.lastName,
            phone_number: customer.phone,
            email: customer.email,
          },
        }
      : {}),
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

function getCoverageSummary(
  sourceItems: TulipItemInput[],
  insuredItems: ResolvedTulipItemInput[],
): TulipCoverageSummary {
  const sourceProductIds = new Set(sourceItems.map((item) => item.productId))
  const insuredProductIds = new Set(insuredItems.map((item) => item.productId))

  return {
    insuredProductCount: insuredProductIds.size,
    uninsuredProductCount: Math.max(sourceProductIds.size - insuredProductIds.size, 0),
    insuredProductIds: Array.from(insuredProductIds),
  }
}

async function resolveTulipCoverage(
  items: TulipItemInput[],
): Promise<{ insuredItems: ResolvedTulipItemInput[] } & TulipCoverageSummary> {
  if (items.length === 0) {
    return {
      insuredItems: [],
      insuredProductCount: 0,
      uninsuredProductCount: 0,
      insuredProductIds: [],
    }
  }

  const productIds = [...new Set(items.map((item) => item.productId))]
  const mappingMap = await getTulipMappingMap(productIds)

  const insuredItems: ResolvedTulipItemInput[] = []
  for (const item of items) {
    const tulipProductId = mappingMap.get(item.productId)
    if (!tulipProductId) {
      continue
    }

    insuredItems.push({
      productId: item.productId,
      tulipProductId,
      quantity: item.quantity,
    })
  }

  return {
    insuredItems,
    ...getCoverageSummary(items, insuredItems),
  }
}

export async function getTulipCoverageSummary(
  items: TulipItemInput[],
): Promise<TulipCoverageSummary> {
  const coverage = await resolveTulipCoverage(items)
  return {
    insuredProductCount: coverage.insuredProductCount,
    uninsuredProductCount: coverage.uninsuredProductCount,
    insuredProductIds: coverage.insuredProductIds,
  }
}

function buildProductPayload(
  items: ResolvedTulipItemInput[],
  userName: string,
): Array<Record<string, unknown>> {
  const productsPayload: Array<Record<string, unknown>> = []
  const productOccurrenceById = new Map<string, number>()

  for (const item of items) {
    let remainingQuantity = item.quantity
    while (remainingQuantity > 0) {
      const nextOccurrence = (productOccurrenceById.get(item.productId) ?? 0) + 1
      productOccurrenceById.set(item.productId, nextOccurrence)

      const serialLikeIdentifier = `${item.productId}-${nextOccurrence}`.trim()
      const safeProductMarked =
        serialLikeIdentifier.length > 0
          ? serialLikeIdentifier
          : `product-${productsPayload.length + 1}`

      productsPayload.push({
        product_id: item.tulipProductId,
        data: {
          user_name: userName,
          product_marked: safeProductMarked,
          internal_id: safeProductMarked,
        },
      })

      remainingQuantity -= 1
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
  insuredItems: ResolvedTulipItemInput[]
}) {
  const userName = `${params.customer.firstName} ${params.customer.lastName}`.trim()
  const productsPayload = buildProductPayload(params.insuredItems, userName)
  const customerPayload = buildCustomerPayload(
    params.customer,
    requiresContractIdentityOption({
      contractType: params.contractType,
      startDate: params.startDate,
      endDate: params.endDate,
    }),
  )

  return {
    uid: params.renterUid,
    test: IS_TULIP_TEST_CONTRACT,
    start_date: params.startDate.toISOString(),
    end_date: params.endDate.toISOString(),
    contract_type: params.contractType,
    options: customerPayload.options,
    products: productsPayload,
    ...(customerPayload.company ? { company: customerPayload.company } : {}),
    ...(customerPayload.individual ? { individual: customerPayload.individual } : {}),
  }
}

function summarizeContractPayloadForLogs(payload: Record<string, unknown>) {
  const products = Array.isArray(payload.products) ? payload.products : []

  let missingProductMarkedCount = 0
  let missingUserNameCount = 0

  for (const product of products) {
    if (!product || typeof product !== 'object') {
      missingProductMarkedCount++
      missingUserNameCount++
      continue
    }

    const productObj = product as {
      product_id?: unknown
      data?: unknown
    }
    const dataObj =
      productObj.data && typeof productObj.data === 'object'
        ? (productObj.data as Record<string, unknown>)
        : null

    const productMarked = dataObj?.product_marked
    if (typeof productMarked !== 'string' || productMarked.trim().length === 0) {
      missingProductMarkedCount++
    }

    const userName = dataObj?.user_name
    if (typeof userName !== 'string' || userName.trim().length === 0) {
      missingUserNameCount++
    }
  }

  const firstProduct =
    products.length > 0 && products[0] && typeof products[0] === 'object'
      ? (products[0] as {
          product_id?: unknown
          data?: unknown
        })
      : null

  const firstProductData =
    firstProduct?.data && typeof firstProduct.data === 'object'
      ? (firstProduct.data as Record<string, unknown>)
      : null

  return {
    contractType:
      typeof payload.contract_type === 'string' ? payload.contract_type : undefined,
    options: Array.isArray(payload.options)
      ? payload.options.filter((option): option is string => typeof option === 'string')
      : [],
    productsCount: products.length,
    missingProductMarkedCount,
    missingUserNameCount,
    sampleProduct: firstProduct
      ? {
          productId:
            typeof firstProduct.product_id === 'string'
              ? firstProduct.product_id
              : undefined,
          hasUserName:
            typeof firstProductData?.user_name === 'string' &&
            firstProductData.user_name.trim().length > 0,
          hasProductMarked:
            typeof firstProductData?.product_marked === 'string' &&
            firstProductData.product_marked.trim().length > 0,
          hasInternalId:
            typeof firstProductData?.internal_id === 'string' &&
            firstProductData.internal_id.trim().length > 0,
        }
      : null,
  }
}

function getOptionVariants(options: string[]): string[][] {
  const normalized = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)))
  if (normalized.length === 0) {
    return [[]]
  }

  const hasBreak = normalized.includes('break')
  const hasTheft = normalized.includes('theft')
  const identityOptions = normalized.filter((option) => option !== 'break' && option !== 'theft')

  const variants: string[][] = [normalized]
  if (hasBreak && hasTheft) {
    variants.push([...identityOptions, 'break'])
    variants.push([...identityOptions, 'theft'])
  }

  const seen = new Set<string>()
  return variants.filter((variant) => {
    const key = [...variant].sort().join('|')
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

async function tulipCreateContractWithOptionsFallback(params: {
  apiKey: string
  payload: Record<string, unknown>
  preview: boolean
  storeIdForLog?: string
  reservationIdForLog?: string
}) {
  const originalOptions = Array.isArray(params.payload.options)
    ? (params.payload.options as unknown[]).filter(
        (option): option is string => typeof option === 'string',
      )
    : []

  const optionVariants = getOptionVariants(originalOptions)
  let lastError: unknown = null

  for (let index = 0; index < optionVariants.length; index++) {
    const variant = optionVariants[index]

    try {
      return await tulipCreateContract(
        params.apiKey,
        {
          ...params.payload,
          options: variant,
        },
        params.preview,
      )
    } catch (error) {
      lastError = error

      const isTulipApiError = error instanceof TulipApiError
      const tulipErrorCode = isTulipApiError ? getTulipErrorCode(error.payload) : null
      const canRetryWithAnotherVariant =
        isTulipApiError &&
        tulipErrorCode === 1010 &&
        index < optionVariants.length - 1

      if (canRetryWithAnotherVariant) {
        console.warn('[tulip][contract-options] retrying with fallback options', {
          storeId: params.storeIdForLog,
          reservationId: params.reservationIdForLog,
          preview: params.preview,
          failedOptions: variant,
          nextOptions: optionVariants[index + 1],
          errorCode: tulipErrorCode,
          status: error.status,
        })
        continue
      }

      throw error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('errors.tulipQuoteFailed')
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

function getLegacyTulipInsuranceAmount(
  items: Array<{
    isCustomItem: boolean
    productSnapshot: unknown
    totalPrice: string
  }>,
): number {
  let total = 0

  for (const item of items) {
    if (!item.isCustomItem) {
      continue
    }

    const snapshotName =
      item.productSnapshot && typeof item.productSnapshot === 'object'
        ? (item.productSnapshot as { name?: unknown }).name
        : null

    const normalizedName =
      typeof snapshotName === 'string' ? snapshotName.trim().toLowerCase() : ''

    if (!LEGACY_INSURANCE_LABELS.includes(normalizedName)) {
      continue
    }

    const parsedAmount = Number(item.totalPrice)
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      total += parsedAmount
    }
  }

  return Math.round(total * 100) / 100
}

function getReservationInsuranceSelection(reservation: {
  tulipInsuranceOptIn: boolean | null
  tulipInsuranceAmount: string | null
  items: Array<{
    isCustomItem: boolean
    productSnapshot: unknown
    totalPrice: string
  }>
}): { optIn: boolean; amount: number } {
  if (
    reservation.tulipInsuranceOptIn === null &&
    reservation.tulipInsuranceAmount === null
  ) {
    const legacyAmount = getLegacyTulipInsuranceAmount(reservation.items)
    return {
      optIn: legacyAmount > 0,
      amount: legacyAmount,
    }
  }

  const parsedAmount = Number(reservation.tulipInsuranceAmount ?? '0')
  return {
    optIn: reservation.tulipInsuranceOptIn === true,
    amount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0,
  }
}

export async function previewTulipQuoteForCheckout(params: {
  storeId: string
  storeSettings: any
  customer: TulipCustomerInput
  items: TulipItemInput[]
  startDate: Date
  endDate: Date
  optIn: boolean | undefined
}): Promise<TulipQuotePreviewResult> {
  const coverage = await resolveTulipCoverage(params.items)

  const tulipSettings = getTulipSettings(params.storeSettings)
  if (!tulipSettings.enabled) {
    return {
      shouldApply: false as const,
      amount: 0,
      insuredProductCount: coverage.insuredProductCount,
      uninsuredProductCount: coverage.uninsuredProductCount,
      insuredProductIds: coverage.insuredProductIds,
    }
  }

  const shouldApply = shouldApplyTulipInsurance(tulipSettings.publicMode, params.optIn)

  if (!shouldApply || coverage.insuredProductCount === 0) {
    return {
      shouldApply: false as const,
      amount: 0,
      insuredProductCount: coverage.insuredProductCount,
      uninsuredProductCount: coverage.uninsuredProductCount,
      insuredProductIds: coverage.insuredProductIds,
    }
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
    insuredItems: coverage.insuredItems,
  })

  let contract: Awaited<ReturnType<typeof tulipCreateContract>>
  try {
    contract = await tulipCreateContractWithOptionsFallback({
      apiKey,
      payload,
      preview: true,
      storeIdForLog: params.storeId,
    })
  } catch (error) {
    if (error instanceof TulipApiError) {
      console.error('[tulip][checkout-quote] tulip API rejected quote request', {
        storeId: params.storeId,
        status: error.status,
        message: error.message,
        request: summarizeContractPayloadForLogs(payload),
        payload: error.payload,
      })
    } else {
      console.error('[tulip][checkout-quote] unexpected quote error', {
        storeId: params.storeId,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }

    throw toTulipContractError(error, 'errors.tulipQuoteFailed')
  }

  return {
    shouldApply: true as const,
    amount: Number(contract.price || 0),
    insuredProductCount: coverage.insuredProductCount,
    uninsuredProductCount: coverage.uninsuredProductCount,
    insuredProductIds: coverage.insuredProductIds,
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

  console.info('[tulip][contract-create] start', {
    reservationId: reservation.id,
    storeId: reservation.storeId,
    currentStatus: reservation.tulipContractStatus,
    hasContractId: Boolean(reservation.tulipContractId),
  })

  if (reservation.tulipContractId) {
    console.info('[tulip][contract-create] skipped: already created', {
      reservationId: reservation.id,
      contractId: reservation.tulipContractId,
    })
    return {
      contractId: reservation.tulipContractId,
      created: false,
    }
  }

  if (reservation.tulipContractStatus === 'not_required') {
    console.info('[tulip][contract-create] skipped: not required', {
      reservationId: reservation.id,
    })
    return {
      contractId: null,
      created: false,
    }
  }

  const insuranceSelection = getReservationInsuranceSelection({
    tulipInsuranceOptIn: reservation.tulipInsuranceOptIn,
    tulipInsuranceAmount: reservation.tulipInsuranceAmount,
    items: reservation.items,
  })

  if (!insuranceSelection.optIn || insuranceSelection.amount <= 0) {
    console.info('[tulip][contract-create] marked not required: opt-in disabled or zero amount', {
      reservationId: reservation.id,
      optIn: insuranceSelection.optIn,
      amount: insuranceSelection.amount,
    })
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

  const storeSettings = reservation.store.settings as any
  const tulipSettings = getTulipSettings(storeSettings)

  if (!tulipSettings.enabled) {
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

  const insuranceCandidateItems = reservation.items
    .filter((item) => item.productId && !item.isCustomItem)
    .map((item) => ({
      productId: item.productId!,
      quantity: item.quantity,
    }))

  const coverage = await resolveTulipCoverage(insuranceCandidateItems)

  console.info('[tulip][contract-create] coverage resolved', {
    reservationId: reservation.id,
    insuredProductCount: coverage.insuredProductCount,
    uninsuredProductCount: coverage.uninsuredProductCount,
  })

  if (coverage.insuredProductCount === 0) {
    console.info('[tulip][contract-create] marked not required: no insurable mapped products', {
      reservationId: reservation.id,
    })
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
    insuredItems: coverage.insuredItems,
  })

  let contract: Awaited<ReturnType<typeof tulipCreateContract>>
  try {
    contract = await tulipCreateContractWithOptionsFallback({
      apiKey,
      payload,
      preview: false,
      storeIdForLog: reservation.storeId,
      reservationIdForLog: reservation.id,
    })
  } catch (error) {
    console.error('[tulip][contract-create] api failure', {
      reservationId: reservation.id,
      request: summarizeContractPayloadForLogs(payload),
      error:
        error instanceof Error
          ? error.message
          : 'unknown',
    })
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

  console.info('[tulip][contract-create] success', {
    reservationId: reservation.id,
    contractId,
  })

  return {
    contractId,
    created: true,
  }
}
