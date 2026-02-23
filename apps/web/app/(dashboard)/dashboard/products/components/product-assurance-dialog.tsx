'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Badge,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@louez/ui'

import type {
  TulipCatalogItem,
  TulipProductDraft,
} from '@/lib/integrations/tulip/product-form-utils'
import {
  buildActionInput,
  initDraftFromTulipProduct,
  resolveTulipCatalog,
  validateDraft,
} from '@/lib/integrations/tulip/product-form-utils'

import { TulipProductFormFields } from './tulip-product-form-fields'

export type { TulipProductActionInput as ProductAssuranceActionInput } from '@/lib/integrations/tulip/product-form-utils'

interface ProductAssuranceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  supportsMargin: boolean
  product: {
    id: string
    name: string
    price: number
    tulipProductId: string | null
  }
  tulipCatalog: TulipCatalogItem[]
  tulipProducts: Array<{
    id: string
    title: string
    louezManaged: boolean
    margin: number | null
    valueExcl: number | null
    brand: string | null
    model: string | null
    productType: string | null
    productSubtype: string | null
    purchasedDate: string | null
  }>
  isCreatePending: boolean
  isPushPending: boolean
  onPushProduct: (input: ReturnType<typeof buildActionInput>) => Promise<void>
  onCreateProduct: (input: ReturnType<typeof buildActionInput>) => Promise<void>
}

export function ProductAssuranceDialog({
  open,
  onOpenChange,
  disabled,
  supportsMargin,
  product,
  tulipCatalog,
  tulipProducts,
  isCreatePending,
  isPushPending,
  onPushProduct,
  onCreateProduct,
}: ProductAssuranceDialogProps) {
  const t = useTranslations('dashboard.products.form.assurance.dialog')
  const tAssurance = useTranslations('dashboard.products.form.assurance')

  const [draft, setDraft] = useState<TulipProductDraft | null>(null)

  const tulipProductById = useMemo(
    () => new Map(tulipProducts.map((item) => [item.id, item] as const)),
    [tulipProducts],
  )
  const resolvedCatalog = useMemo(
    () => resolveTulipCatalog(tulipCatalog),
    [tulipCatalog],
  )

  const hasValidMapping =
    !!product.tulipProductId && tulipProductById.has(product.tulipProductId)

  useEffect(() => {
    if (!open) return

    const mappedTulipProduct = product.tulipProductId
      ? (tulipProductById.get(product.tulipProductId) ?? null)
      : null

    setDraft(
      initDraftFromTulipProduct(resolvedCatalog, mappedTulipProduct, product.price),
    )
  }, [open, product.price, product.tulipProductId, resolvedCatalog, tulipProductById])

  const mappedTulipProduct =
    product.tulipProductId && hasValidMapping
      ? (tulipProductById.get(product.tulipProductId) ?? null)
      : null

  const validation = validateDraft(draft)
  const disableSaveButton =
    disabled ||
    !draft ||
    validation.hasMissingProductType ||
    validation.hasMissingSubtype ||
    validation.hasInvalidValueExcl ||
    validation.hasInvalidMargin ||
    validation.hasInvalidPurchasedDate ||
    isCreatePending ||
    isPushPending

  const handleSave = async (mode: 'create' | 'update') => {
    if (!draft) return
    const input = buildActionInput(product.id, draft)

    if (mode === 'update') {
      await onPushProduct(input)
    } else {
      await onCreateProduct(input)
    }

    onOpenChange(false)
  }

  const defaultTitle = mappedTulipProduct
    ? mappedTulipProduct.louezManaged
      ? `${mappedTulipProduct.title} (Louez)`
      : mappedTulipProduct.title
    : product.name

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
                    &rarr; {defaultTitle}
                  </span>
                )}
              </div>

              <TulipProductFormFields
                draft={draft}
                onDraftChange={(updater) => setDraft((prev) => (prev ? updater(prev) : prev))}
                disabled={disabled}
                supportsMargin={supportsMargin}
                defaultPrice={product.price}
                defaultTitle={defaultTitle}
                resolvedCatalog={resolvedCatalog}
                tulipProducts={tulipProducts}
                t={t}
                validation={validation}
              />
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          {hasValidMapping && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSave('create')}
              disabled={disableSaveButton}
            >
              {isCreatePending ? t('creatingButton') : t('createButton')}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => void handleSave(hasValidMapping ? 'update' : 'create')}
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
