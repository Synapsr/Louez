'use client'

import { useMemo, useState } from 'react'

import { Info } from 'lucide-react'

import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  Input,
  Label,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@louez/ui'

import type {
  TulipCatalogItem,
  TulipComboboxOption,
  TulipProductDraft,
} from '@/lib/integrations/tulip/product-form-utils'
import {
  normalizeCatalogValue,
  resolveProductSubtype,
  toUniqueSortedOptions,
} from '@/lib/integrations/tulip/product-form-utils'

interface TulipProductFormFieldsProps {
  draft: TulipProductDraft
  onDraftChange: (updater: (prev: TulipProductDraft) => TulipProductDraft) => void
  disabled: boolean
  supportsMargin: boolean
  defaultPrice: number
  defaultTitle: string
  resolvedCatalog: TulipCatalogItem[]
  tulipProducts: Array<{
    brand: string | null
    model: string | null
  }>
  t: {
    (key: 'fields.productTitle'): string
    (key: 'fields.category'): string
    (key: 'fields.productSubtype'): string
    (key: 'fields.brand'): string
    (key: 'fields.model'): string
    (key: 'fields.purchasedDate'): string
    (key: 'fields.purchasePriceHt'): string
    (key: 'fields.margin'): string
    (key: 'productTitlePlaceholder', values: { defaultTitle: string }): string
    (key: 'categoryPlaceholder'): string
    (key: 'productSubtypePlaceholder'): string
    (key: 'brandPlaceholder'): string
    (key: 'modelPlaceholder'): string
    (key: 'createOption', values: { value: string }): string
    (key: 'noResults'): string
    (key: 'noBrandResults'): string
    (key: 'noModelResults'): string
    (key: 'invalidPurchasePrice'): string
    (key: 'invalidMargin'): string
    (key: 'marginTooltip'): string
    (key: 'invalidPurchasedDate'): string
  }
  validation: {
    hasInvalidValueExcl: boolean
    hasInvalidMargin: boolean
    hasInvalidPurchasedDate: boolean
  }
}

export function TulipProductFormFields({
  draft,
  onDraftChange,
  disabled,
  supportsMargin,
  defaultPrice,
  defaultTitle,
  resolvedCatalog,
  tulipProducts,
  t,
  validation,
}: TulipProductFormFieldsProps) {
  const [brandInputValue, setBrandInputValue] = useState(draft.brand)
  const [modelInputValue, setModelInputValue] = useState(draft.model)

  const currentProductType = draft.productType ?? resolvedCatalog[0]?.type ?? 'event'

  const categoryItems = useMemo(() => {
    const items = resolvedCatalog.map((item) => ({
      label: item.label || item.type,
      value: item.type,
    }))
    const currentType = normalizeCatalogValue(draft.productType)
    if (currentType && !items.some((item) => item.value === currentType)) {
      items.unshift({ label: currentType, value: currentType })
    }
    return items
  }, [draft.productType, resolvedCatalog])

  const subtypeItems = useMemo(() => {
    const typeFromCatalog =
      resolvedCatalog.find((item) => item.type === currentProductType)?.subtypes ?? []
    const items = typeFromCatalog.map((item) => ({
      label: item.label || item.type,
      value: item.type,
    }))
    const currentSubtype = normalizeCatalogValue(draft.productSubtype)
    if (currentSubtype && !items.some((item) => item.value === currentSubtype)) {
      items.unshift({ label: currentSubtype, value: currentSubtype })
    }
    return items
  }, [currentProductType, draft.productSubtype, resolvedCatalog])

  const knownBrandItems = useMemo(
    () => toUniqueSortedOptions(tulipProducts.map((item) => item.brand)),
    [tulipProducts],
  )

  const knownModelItems = useMemo(() => {
    const selectedBrand = draft.brand.trim().toLowerCase()
    const sourceProducts = selectedBrand
      ? tulipProducts.filter(
          (item) => item.brand?.trim().toLowerCase() === selectedBrand,
        )
      : tulipProducts
    return toUniqueSortedOptions(sourceProducts.map((item) => item.model))
  }, [draft.brand, tulipProducts])

  const brandItems = useMemo(() => {
    const customValue = brandInputValue.trim()
    if (!customValue) return knownBrandItems
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
    if (!customValue) return knownModelItems
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

  const handleBrandChange = (value: string) => {
    setBrandInputValue(value)
    onDraftChange((prev) => ({ ...prev, brand: value }))
  }

  const handleBrandSelect = (item: TulipComboboxOption | null) => {
    if (!item) return
    setBrandInputValue(item.value)
    onDraftChange((prev) => ({ ...prev, brand: item.value }))
  }

  const handleBrandBlur = () => {
    const nextValue = brandInputValue.trim()
    setBrandInputValue(nextValue)
    onDraftChange((prev) => ({ ...prev, brand: nextValue }))
  }

  const handleModelChange = (value: string) => {
    setModelInputValue(value)
    onDraftChange((prev) => ({ ...prev, model: value }))
  }

  const handleModelSelect = (item: TulipComboboxOption | null) => {
    if (!item) return
    setModelInputValue(item.value)
    onDraftChange((prev) => ({ ...prev, model: item.value }))
  }

  const handleModelBlur = () => {
    const nextValue = modelInputValue.trim()
    setModelInputValue(nextValue)
    onDraftChange((prev) => ({ ...prev, model: nextValue }))
  }

  return (
    <>
      {/* Product title */}
      <div className="space-y-2">
        <Label>{t('fields.productTitle')}</Label>
        <Input
          value={draft.title}
          placeholder={t('productTitlePlaceholder', { defaultTitle })}
          onChange={(event) =>
            onDraftChange((prev) => ({ ...prev, title: event.target.value }))
          }
          disabled={disabled}
        />
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label>{t('fields.category')}</Label>
        <Combobox
          items={categoryItems}
          value={
            categoryItems.find((item) => item.value === draft.productType) ?? null
          }
          onValueChange={(item) => {
            if (!item) return
            onDraftChange((prev) => ({
              ...prev,
              productType: item.value,
              productSubtype: resolveProductSubtype(
                resolvedCatalog,
                item.value,
                prev.productSubtype,
              ),
            }))
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

      {/* Subtype */}
      <div className="space-y-2">
        <Label>{t('fields.productSubtype')}</Label>
        <Combobox
          items={subtypeItems}
          value={
            subtypeItems.find((item) => item.value === draft.productSubtype) ?? null
          }
          onValueChange={(item) => {
            if (!item) return
            onDraftChange((prev) => ({ ...prev, productSubtype: item.value }))
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

      {/* Brand */}
      <div className="space-y-2">
        <Label>{t('fields.brand')}</Label>
        <Combobox
          items={brandItems}
          value={
            brandItems.find(
              (item) =>
                item.value.toLowerCase() === draft.brand.trim().toLowerCase(),
            ) ?? null
          }
          inputValue={brandInputValue}
          onInputValueChange={(value) => {
            if (value === undefined) return
            handleBrandChange(value)
          }}
          onValueChange={handleBrandSelect}
        >
          <ComboboxInput
            showTrigger
            placeholder={t('brandPlaceholder')}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              handleBrandBlur()
              event.currentTarget.blur()
            }}
            onBlur={handleBrandBlur}
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

      {/* Model */}
      <div className="space-y-2">
        <Label>{t('fields.model')}</Label>
        <Combobox
          items={modelItems}
          value={
            modelItems.find(
              (item) =>
                item.value.toLowerCase() === draft.model.trim().toLowerCase(),
            ) ?? null
          }
          inputValue={modelInputValue}
          onInputValueChange={(value) => {
            if (value === undefined) return
            handleModelChange(value)
          }}
          onValueChange={handleModelSelect}
        >
          <ComboboxInput
            showTrigger
            placeholder={t('modelPlaceholder')}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              handleModelBlur()
              event.currentTarget.blur()
            }}
            onBlur={handleModelBlur}
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

      {/* Purchase date */}
      <div className="space-y-2">
        <Label>{t('fields.purchasedDate')}</Label>
        <Input
          type="date"
          value={draft.purchasedDate}
          onChange={(event) =>
            onDraftChange((prev) => ({ ...prev, purchasedDate: event.target.value }))
          }
          disabled={disabled}
        />
        {validation.hasInvalidPurchasedDate && (
          <p className="text-destructive text-xs">{t('invalidPurchasedDate')}</p>
        )}
      </div>

      {/* Purchase price */}
      <div className="space-y-2">
        <Label>{t('fields.purchasePriceHt')}</Label>
        <Input
          value={draft.valueExcl}
          placeholder={defaultPrice.toFixed(2)}
          onChange={(event) =>
            onDraftChange((prev) => ({ ...prev, valueExcl: event.target.value }))
          }
          disabled={disabled}
        />
        {validation.hasInvalidValueExcl && (
          <p className="text-destructive text-xs">{t('invalidPurchasePrice')}</p>
        )}
      </div>

      {/* Margin */}
      {supportsMargin && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label>{t('fields.margin')}</Label>
            <Tooltip>
              <TooltipTrigger className="text-muted-foreground hover:text-foreground transition-colors">
                <Info className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('marginTooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            value={draft.margin}
            placeholder="0.00"
            onChange={(event) =>
              onDraftChange((prev) => ({ ...prev, margin: event.target.value }))
            }
            disabled={disabled}
          />
          {validation.hasInvalidMargin && (
            <p className="text-destructive text-xs">{t('invalidMargin')}</p>
          )}
        </div>
      )}
    </>
  )
}
