'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Badge,
  Button,
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
} from '@louez/ui'

const TULIP_PRODUCT_TYPES = [
  'bike',
  'wintersports',
  'watersports',
  'event',
  'high-tech',
  'small-tools',
] as const

type TulipProductType = (typeof TULIP_PRODUCT_TYPES)[number]

const TULIP_SUBTYPES_BY_TYPE = {
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
} as const satisfies Record<TulipProductType, readonly string[]>

type TulipProductSubtype =
  (typeof TULIP_SUBTYPES_BY_TYPE)[TulipProductType][number]

type ComboboxOption = {
  label: string
  value: string
  kind?: 'existing' | 'create'
}

type DialogDraft = {
  title: string
  brand: string
  model: string
  valueExcl: string
  productType: TulipProductType
  productSubtype: TulipProductSubtype
  purchasedDate: string
}

function getSubtypeOptionsForType(
  productType: TulipProductType,
): readonly TulipProductSubtype[] {
  return TULIP_SUBTYPES_BY_TYPE[productType]
}

function normalizeTulipProductType(
  value: string | null | undefined,
): TulipProductType {
  if (value && (TULIP_PRODUCT_TYPES as readonly string[]).includes(value)) {
    return value as TulipProductType
  }

  return 'event'
}

function normalizeTulipProductSubtype(
  value: string | null | undefined,
  productType: TulipProductType,
): TulipProductSubtype {
  const allowedSubtypes = getSubtypeOptionsForType(productType)
  if (value && (allowedSubtypes as readonly string[]).includes(value)) {
    return value as TulipProductSubtype
  }

  return allowedSubtypes[0] ?? 'standard'
}

function toUniqueSortedOptions(
  values: Array<string | null | undefined>,
): ComboboxOption[] {
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

export type ProductAssuranceActionInput = {
  productId: string
  title: string | null
  brand: string | null
  model: string | null
  valueExcl: number | null
  productType: TulipProductType | null
  productSubtype: TulipProductSubtype | null
  purchasedDate: string | null
}

interface ProductAssuranceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  product: {
    id: string
    name: string
    price: number
    tulipProductId: string | null
  }
  tulipProducts: Array<{
    id: string
    title: string
    valueExcl: number | null
    brand: string | null
    model: string | null
    productType: string | null
    productSubtype: string | null
    purchasedDate: string | null
  }>
  isCreatePending: boolean
  isPushPending: boolean
  onPushProduct: (input: ProductAssuranceActionInput) => Promise<void>
  onCreateProduct: (input: ProductAssuranceActionInput) => Promise<void>
}

export function ProductAssuranceDialog({
  open,
  onOpenChange,
  disabled,
  product,
  tulipProducts,
  isCreatePending,
  isPushPending,
  onPushProduct,
  onCreateProduct,
}: ProductAssuranceDialogProps) {
  const t = useTranslations('dashboard.products.form.assurance.dialog')
  const tAssurance = useTranslations('dashboard.products.form.assurance')

  const [draft, setDraft] = useState<DialogDraft | null>(null)
  const [brandInputValue, setBrandInputValue] = useState('')
  const [modelInputValue, setModelInputValue] = useState('')

  const tulipProductById = useMemo(
    () => new Map(tulipProducts.map((item) => [item.id, item] as const)),
    [tulipProducts],
  )

  const hasValidMapping =
    !!product.tulipProductId && tulipProductById.has(product.tulipProductId)

  useEffect(() => {
    if (!open) return

    const mappedTulipProduct = product.tulipProductId
      ? (tulipProductById.get(product.tulipProductId) ?? null)
      : null
    const resolvedProductType = normalizeTulipProductType(
      mappedTulipProduct?.productType,
    )

    setDraft({
      title: '',
      productType: resolvedProductType,
      productSubtype: normalizeTulipProductSubtype(
        mappedTulipProduct?.productSubtype,
        resolvedProductType,
      ),
      brand: mappedTulipProduct?.brand ?? '',
      model: mappedTulipProduct?.model ?? '',
      purchasedDate: mappedTulipProduct?.purchasedDate
        ? mappedTulipProduct.purchasedDate.slice(0, 10)
        : '',
      valueExcl:
        mappedTulipProduct?.valueExcl != null
          ? mappedTulipProduct.valueExcl.toFixed(2)
          : product.price.toFixed(2),
    })
    setBrandInputValue(mappedTulipProduct?.brand ?? '')
    setModelInputValue(mappedTulipProduct?.model ?? '')
  }, [open, product.price, product.tulipProductId, tulipProductById])

  const mappedTulipProduct =
    product.tulipProductId && hasValidMapping
      ? (tulipProductById.get(product.tulipProductId) ?? null)
      : null

  const subtypeItems = useMemo(
    () =>
      getSubtypeOptionsForType(draft?.productType ?? 'event').map((value) => ({
        label: value,
        value,
      })),
    [draft?.productType],
  )

  const categoryItems = useMemo(
    () => TULIP_PRODUCT_TYPES.map((value) => ({ label: value, value })),
    [],
  )

  const knownBrandItems = useMemo(
    () => toUniqueSortedOptions(tulipProducts.map((item) => item.brand)),
    [tulipProducts],
  )

  const knownModelItems = useMemo(() => {
    const selectedBrand = draft?.brand.trim().toLowerCase()
    const sourceProducts = selectedBrand
      ? tulipProducts.filter(
          (item) => item.brand?.trim().toLowerCase() === selectedBrand,
        )
      : tulipProducts

    return toUniqueSortedOptions(sourceProducts.map((item) => item.model))
  }, [draft?.brand, tulipProducts])

  const brandItems = useMemo(() => {
    const customValue = brandInputValue.trim()
    if (!customValue) {
      return knownBrandItems
    }

    if (
      knownBrandItems.some(
        (item) => item.value.toLowerCase() === customValue.toLowerCase(),
      )
    ) {
      return knownBrandItems
    }

    return [
      { label: customValue, value: customValue, kind: 'create' as const },
      ...knownBrandItems,
    ]
  }, [brandInputValue, knownBrandItems])

  const modelItems = useMemo(() => {
    const customValue = modelInputValue.trim()
    if (!customValue) {
      return knownModelItems
    }

    if (
      knownModelItems.some(
        (item) => item.value.toLowerCase() === customValue.toLowerCase(),
      )
    ) {
      return knownModelItems
    }

    return [
      { label: customValue, value: customValue, kind: 'create' as const },
      ...knownModelItems,
    ]
  }, [knownModelItems, modelInputValue])

  const normalizedValueExcl = draft?.valueExcl.trim().replace(',', '.') ?? ''
  const parsedValueExcl =
    normalizedValueExcl.length === 0 ? null : Number(normalizedValueExcl)
  const hasInvalidValueExcl =
    normalizedValueExcl.length > 0 && !Number.isFinite(parsedValueExcl)

  const hasInvalidPurchasedDate = draft?.purchasedDate
    ? Number.isNaN(new Date(`${draft.purchasedDate}T00:00:00.000Z`).getTime())
    : false

  const disableSaveButton =
    disabled ||
    !draft ||
    hasInvalidValueExcl ||
    hasInvalidPurchasedDate ||
    isCreatePending ||
    isPushPending

  const handleSave = async () => {
    if (!draft) return

    const normalized = draft.valueExcl.trim().replace(',', '.')
    const parsed = normalized.length === 0 ? null : Number(normalized)

    const input: ProductAssuranceActionInput = {
      productId: product.id,
      title: draft.title.trim() || null,
      productType: draft.productType,
      productSubtype: draft.productSubtype,
      brand: draft.brand.trim() || null,
      model: draft.model.trim() || null,
      purchasedDate: draft.purchasedDate
        ? new Date(`${draft.purchasedDate}T00:00:00.000Z`).toISOString()
        : null,
      valueExcl: Number.isFinite(parsed) ? parsed : null,
    }

    if (hasValidMapping) {
      await onPushProduct(input)
    } else {
      await onCreateProduct(input)
    }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {draft && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <Badge variant={hasValidMapping ? 'success' : 'secondary'} size="sm">
                  {hasValidMapping
                    ? tAssurance('statusMapped')
                    : tAssurance('statusNotMapped')}
                </Badge>
                {hasValidMapping && mappedTulipProduct && (
                  <span className="text-muted-foreground text-sm">
                    &rarr; {mappedTulipProduct.title}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('fields.productTitle')}</Label>
                <Input
                  value={draft.title}
                  placeholder={t('productTitlePlaceholder', {
                    defaultTitle: mappedTulipProduct?.title || product.name,
                  })}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev ? { ...prev, title: event.target.value } : prev,
                    )
                  }
                  disabled={disabled}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('fields.category')}</Label>
                <Combobox
                  items={categoryItems}
                  value={
                    categoryItems.find((item) => item.value === draft.productType) ??
                    null
                  }
                  onValueChange={(item) => {
                    if (!item) return
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            productType: item.value as TulipProductType,
                            productSubtype: normalizeTulipProductSubtype(
                              prev.productSubtype,
                              item.value as TulipProductType,
                            ),
                          }
                        : prev,
                    )
                  }}
                >
                  <ComboboxInput
                    showTrigger
                    placeholder={t('categoryPlaceholder')}
                    disabled={disabled}
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty>{t('noResults')}</ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              </div>

              <div className="space-y-2">
                <Label>{t('fields.productSubtype')}</Label>
                <Combobox
                  items={subtypeItems}
                  value={
                    subtypeItems.find(
                      (item) => item.value === draft.productSubtype,
                    ) ?? null
                  }
                  onValueChange={(item) => {
                    if (!item) return
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            productSubtype: item.value as TulipProductSubtype,
                          }
                        : prev,
                    )
                  }}
                >
                  <ComboboxInput
                    showTrigger
                    placeholder={t('productSubtypePlaceholder')}
                    disabled={disabled}
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty>{t('noResults')}</ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              </div>

              <div className="space-y-2">
                <Label>{t('fields.brand')}</Label>
                <Combobox
                  items={brandItems}
                  value={
                    brandItems.find(
                      (item) =>
                        item.value.toLowerCase() ===
                        draft.brand.trim().toLowerCase(),
                    ) ?? null
                  }
                  inputValue={brandInputValue}
                  onInputValueChange={(value) => {
                    if (value === undefined) return
                    setBrandInputValue(value)
                    setDraft((prev) =>
                      prev ? { ...prev, brand: value } : prev,
                    )
                  }}
                  onValueChange={(item) => {
                    if (!item) return
                    setBrandInputValue(item.value)
                    setDraft((prev) =>
                      prev ? { ...prev, brand: item.value } : prev,
                    )
                  }}
                >
                  <ComboboxInput
                    showTrigger
                    placeholder={t('brandPlaceholder')}
                    disabled={disabled}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      const nextValue = brandInputValue.trim()
                      setBrandInputValue(nextValue)
                      setDraft((prev) =>
                        prev ? { ...prev, brand: nextValue } : prev,
                      )
                      event.currentTarget.blur()
                    }}
                    onBlur={() => {
                      const nextValue = brandInputValue.trim()
                      setBrandInputValue(nextValue)
                      setDraft((prev) =>
                        prev ? { ...prev, brand: nextValue } : prev,
                      )
                    }}
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty>{t('noBrandResults')}</ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.kind === 'create'
                            ? t('createOption', { value: item.value })
                            : item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              </div>

              <div className="space-y-2">
                <Label>{t('fields.model')}</Label>
                <Combobox
                  items={modelItems}
                  value={
                    modelItems.find(
                      (item) =>
                        item.value.toLowerCase() ===
                        draft.model.trim().toLowerCase(),
                    ) ?? null
                  }
                  inputValue={modelInputValue}
                  onInputValueChange={(value) => {
                    if (value === undefined) return
                    setModelInputValue(value)
                    setDraft((prev) =>
                      prev ? { ...prev, model: value } : prev,
                    )
                  }}
                  onValueChange={(item) => {
                    if (!item) return
                    setModelInputValue(item.value)
                    setDraft((prev) =>
                      prev ? { ...prev, model: item.value } : prev,
                    )
                  }}
                >
                  <ComboboxInput
                    showTrigger
                    placeholder={t('modelPlaceholder')}
                    disabled={disabled}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      const nextValue = modelInputValue.trim()
                      setModelInputValue(nextValue)
                      setDraft((prev) =>
                        prev ? { ...prev, model: nextValue } : prev,
                      )
                      event.currentTarget.blur()
                    }}
                    onBlur={() => {
                      const nextValue = modelInputValue.trim()
                      setModelInputValue(nextValue)
                      setDraft((prev) =>
                        prev ? { ...prev, model: nextValue } : prev,
                      )
                    }}
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty>{t('noModelResults')}</ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.kind === 'create'
                            ? t('createOption', { value: item.value })
                            : item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              </div>

              <div className="space-y-2">
                <Label>{t('fields.purchasedDate')}</Label>
                <Input
                  type="date"
                  value={draft.purchasedDate}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev
                        ? { ...prev, purchasedDate: event.target.value }
                        : prev,
                    )
                  }
                  disabled={disabled}
                />
                {hasInvalidPurchasedDate && (
                  <p className="text-destructive text-xs">
                    {t('invalidPurchasedDate')}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('fields.purchasePriceHt')}</Label>
                <Input
                  value={draft.valueExcl}
                  placeholder={product.price.toFixed(2)}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev ? { ...prev, valueExcl: event.target.value } : prev,
                    )
                  }
                  disabled={disabled}
                />
                {hasInvalidValueExcl && (
                  <p className="text-destructive text-xs">
                    {t('invalidPurchasePrice')}
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={disableSaveButton}
          >
            {hasValidMapping
              ? isPushPending
                ? t('updatingButton')
                : t('updateButton')
              : isCreatePending
                ? t('creatingButton')
                : t('createButton')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
