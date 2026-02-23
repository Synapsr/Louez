export type TulipCatalogItem = {
  type: string
  label: string
  subtypes: Array<{
    type: string
    label: string
  }>
}

export type TulipProductDraft = {
  title: string
  brand: string
  model: string
  valueExcl: string
  margin: string
  productType: string
  productSubtype: string
  purchasedDate: string
}

export type TulipComboboxOption = {
  label: string
  value: string
  kind?: 'existing' | 'create'
}

export type TulipProductActionInput = {
  productId: string
  title: string | null
  brand: string | null
  model: string | null
  valueExcl: number | null
  margin: number | null
  productType: string | null
  productSubtype: string | null
  purchasedDate: string | null
}

export const TULIP_FALLBACK_CATALOG: TulipCatalogItem[] = [
  {
    type: 'bike',
    label: 'bike',
    subtypes: ['standard', 'electric', 'cargo', 'remorque'].map((value) => ({
      type: value,
      label: value,
    })),
  },
  {
    type: 'wintersports',
    label: 'wintersports',
    subtypes: ['ski', 'snowboard', 'snowshoe'].map((value) => ({
      type: value,
      label: value,
    })),
  },
  {
    type: 'watersports',
    label: 'watersports',
    subtypes: [
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
    ].map((value) => ({ type: value, label: value })),
  },
  {
    type: 'event',
    label: 'event',
    subtypes: ['furniture', 'tent', 'decorations', 'tableware', 'entertainment'].map(
      (value) => ({ type: value, label: value }),
    ),
  },
  {
    type: 'high-tech',
    label: 'high-tech',
    subtypes: [
      'action-cam',
      'drone',
      'camera',
      'video-camera',
      'stabilizer',
      'phone',
      'computer',
      'tablet',
    ].map((value) => ({ type: value, label: value })),
  },
  {
    type: 'small-tools',
    label: 'small-tools',
    subtypes: [
      'small-appliance',
      'large-appliance',
      'construction-equipment',
      'diy-tools',
      'electric-diy-tools',
      'gardening-tools',
      'electric-gardening-tools',
    ].map((value) => ({ type: value, label: value })),
  },
]

export function normalizeCatalogValue(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized || null
}

export function resolveProductType(
  catalog: TulipCatalogItem[],
  value: string | null | undefined,
): string {
  return (
    normalizeCatalogValue(value) ||
    catalog[0]?.type ||
    TULIP_FALLBACK_CATALOG[0]?.type ||
    'event'
  )
}

export function resolveProductSubtype(
  catalog: TulipCatalogItem[],
  productType: string,
  value: string | null | undefined,
): string {
  const normalized = normalizeCatalogValue(value)
  const subtypeList =
    catalog.find((item) => item.type === productType)?.subtypes ?? []

  if (normalized) {
    if (subtypeList.length === 0) {
      return normalized
    }
    const match = subtypeList.find((item) => item.type === normalized)
    if (match) {
      return match.type
    }
  }

  return subtypeList[0]?.type || normalized || 'standard'
}

export function toUniqueSortedOptions(
  values: Array<string | null | undefined>,
): TulipComboboxOption[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  )
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ label: value, value, kind: 'existing' as const }))
}

export function buildActionInput(
  productId: string,
  draft: TulipProductDraft,
): TulipProductActionInput {
  const normalized = draft.valueExcl.trim().replace(',', '.')
  const parsed = normalized.length === 0 ? null : Number(normalized)
  const normalizedMarginInput = draft.margin.trim().replace(',', '.')
  const parsedMarginInput =
    normalizedMarginInput.length === 0 ? null : Number(normalizedMarginInput)

  return {
    productId,
    title: draft.title.trim() || null,
    productType: normalizeCatalogValue(draft.productType),
    productSubtype: normalizeCatalogValue(draft.productSubtype),
    brand: draft.brand.trim() || null,
    model: draft.model.trim() || null,
    purchasedDate: draft.purchasedDate
      ? new Date(`${draft.purchasedDate}T00:00:00.000Z`).toISOString()
      : null,
    valueExcl: Number.isFinite(parsed) ? parsed : null,
    margin:
      Number.isFinite(parsedMarginInput) && Number(parsedMarginInput) >= 0
        ? Number(parsedMarginInput)
        : null,
  }
}

export function validateDraft(draft: TulipProductDraft | null) {
  if (!draft) {
    return {
      hasInvalidValueExcl: false,
      hasInvalidMargin: false,
      hasInvalidPurchasedDate: false,
      hasMissingProductType: true,
      hasMissingSubtype: true,
    }
  }

  const normalizedValueExcl = draft.valueExcl.trim().replace(',', '.') ?? ''
  const parsedValueExcl =
    normalizedValueExcl.length === 0 ? null : Number(normalizedValueExcl)
  const normalizedMargin = draft.margin.trim().replace(',', '.') ?? ''
  const parsedMargin = normalizedMargin.length === 0 ? null : Number(normalizedMargin)

  return {
    hasInvalidValueExcl:
      normalizedValueExcl.length > 0 && !Number.isFinite(parsedValueExcl),
    hasInvalidMargin:
      normalizedMargin.length > 0 &&
      (!Number.isFinite(parsedMargin) || Number(parsedMargin) < 0),
    hasInvalidPurchasedDate: draft.purchasedDate
      ? Number.isNaN(new Date(`${draft.purchasedDate}T00:00:00.000Z`).getTime())
      : false,
    hasMissingProductType: !normalizeCatalogValue(draft.productType),
    hasMissingSubtype: !normalizeCatalogValue(draft.productSubtype),
  }
}

export function resolveTulipCatalog(catalog: TulipCatalogItem[]): TulipCatalogItem[] {
  return catalog.length > 0 ? catalog : TULIP_FALLBACK_CATALOG
}

export function initDraftFromTulipProduct(
  resolvedCatalog: TulipCatalogItem[],
  tulipProduct: {
    brand: string | null
    model: string | null
    productType: string | null
    productSubtype: string | null
    purchasedDate: string | null
    valueExcl: number | null
    margin: number | null
  } | null,
  fallbackPrice: number,
): TulipProductDraft {
  const resolvedType = resolveProductType(resolvedCatalog, tulipProduct?.productType)

  return {
    title: '',
    productType: resolvedType,
    productSubtype: resolveProductSubtype(
      resolvedCatalog,
      resolvedType,
      tulipProduct?.productSubtype,
    ),
    brand: tulipProduct?.brand ?? '',
    model: tulipProduct?.model ?? '',
    purchasedDate: tulipProduct?.purchasedDate
      ? tulipProduct.purchasedDate.slice(0, 10)
      : '',
    valueExcl:
      tulipProduct?.valueExcl != null
        ? tulipProduct.valueExcl.toFixed(2)
        : fallbackPrice.toFixed(2),
    margin:
      tulipProduct?.margin != null ? tulipProduct.margin.toFixed(2) : '',
  }
}
