'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@louez/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@louez/ui'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@louez/ui'

type ProductActionInput = {
  productId: string
  brand: string | null
  model: string | null
  valueExcl: number | null
  productType: string | null
}

interface TulipProductMappingSectionProps {
  disabled: boolean
  products: Array<{
    id: string
    name: string
    price: number
    tulipProductId: string | null
  }>
  tulipProducts: Array<{
    id: string
    title: string
    valueExcl: number | null
    brand: string | null
    model: string | null
    productType: string | null
  }>
  isMappingPending: boolean
  mappingProductId: string | null
  isPushPending: boolean
  pushProductId: string | null
  isCreatePending: boolean
  createProductId: string | null
  isRefreshing: boolean
  onMappingChange: (productId: string, tulipProductId: string | null) => Promise<void>
  onPushProduct: (input: ProductActionInput) => Promise<void>
  onCreateProduct: (input: ProductActionInput) => Promise<void>
  onRefresh: () => Promise<void>
}

export function TulipProductMappingSection({
  disabled,
  products,
  tulipProducts,
  isMappingPending,
  mappingProductId,
  isPushPending,
  pushProductId,
  isCreatePending,
  createProductId,
  isRefreshing,
  onMappingChange,
  onPushProduct,
  onCreateProduct,
  onRefresh,
}: TulipProductMappingSectionProps) {
  const t = useTranslations('dashboard.settings.integrationsPage.assurance.mapping')
  const [drafts, setDrafts] = useState<Record<string, { brand: string; model: string; valueExcl: string; productType: string }>>({})
  const categoryOptions = Array.from(
    new Set([
      'event',
      ...tulipProducts
        .map((product) => product.productType?.trim())
        .filter((productType): productType is string => Boolean(productType)),
    ]),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {t('disabledMessage')}
          </p>
        )}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.product')}</TableHead>
                <TableHead>{t('columns.tulipProduct')}</TableHead>
                <TableHead>{t('columns.category')}</TableHead>
                <TableHead>{t('columns.brand')}</TableHead>
                <TableHead>{t('columns.model')}</TableHead>
                <TableHead>{t('columns.purchasePriceHt')}</TableHead>
                <TableHead className="w-[160px] text-right">{t('columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    {t('emptyState')}
                  </TableCell>
                </TableRow>
              )}

              {products.map((product) => {
                const selectedTulipProduct = tulipProducts.find(
                  (tulipProduct) => tulipProduct.id === product.tulipProductId,
                )
                const draft = drafts[product.id] ?? {
                  productType: selectedTulipProduct?.productType ?? 'event',
                  brand: selectedTulipProduct?.brand ?? '',
                  model: selectedTulipProduct?.model ?? '',
                  valueExcl:
                    selectedTulipProduct?.valueExcl !== null &&
                    selectedTulipProduct?.valueExcl !== undefined
                      ? selectedTulipProduct.valueExcl.toFixed(2)
                      : product.price.toFixed(2),
                }
                const normalizedValueExcl = draft.valueExcl.trim().replace(',', '.')
                const parsedValueExcl =
                  normalizedValueExcl.length === 0 ? null : Number(normalizedValueExcl)
                const hasInvalidValueExcl =
                  normalizedValueExcl.length > 0 && !Number.isFinite(parsedValueExcl)
                const disableRowActions = disabled || isRefreshing || hasInvalidValueExcl

                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>
                      <Select
                        value={product.tulipProductId ?? undefined}
                        onValueChange={(value) => {
                          const nextValue = value && value !== '__none__' ? value : null
                          void onMappingChange(product.id, nextValue)
                        }}
                        disabled={
                          disabled ||
                          isMappingPending ||
                          isRefreshing ||
                          tulipProducts.length === 0
                        }
                      >
                        <SelectTrigger className="min-w-[220px]">
                          <SelectValue placeholder={t('notMapped')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{t('notMapped')}</SelectItem>
                          {tulipProducts.map((tulipProduct) => (
                            <SelectItem key={tulipProduct.id} value={tulipProduct.id}>
                              {tulipProduct.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={draft.productType}
                        onValueChange={(value) => {
                          setDrafts((prev) => ({
                            ...prev,
                            [product.id]: { ...draft, productType: value || 'event' },
                          }))
                        }}
                        disabled={disableRowActions}
                      >
                        <SelectTrigger className="min-w-[160px]">
                          <SelectValue placeholder={t('categoryPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.brand}
                        placeholder={t('brandPlaceholder')}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          setDrafts((prev) => ({
                            ...prev,
                            [product.id]: { ...draft, brand: nextValue },
                          }))
                        }}
                        disabled={disableRowActions}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.model}
                        placeholder={t('modelPlaceholder')}
                        onChange={(event) => {
                          const nextValue = event.target.value
                          setDrafts((prev) => ({
                            ...prev,
                            [product.id]: { ...draft, model: nextValue },
                          }))
                        }}
                        disabled={disableRowActions}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Input
                          value={draft.valueExcl}
                          placeholder={product.price.toFixed(2)}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            setDrafts((prev) => ({
                              ...prev,
                              [product.id]: { ...draft, valueExcl: nextValue },
                            }))
                          }}
                          disabled={disableRowActions}
                        />
                        {hasInvalidValueExcl && (
                          <p className="text-xs text-destructive">{t('invalidPurchasePrice')}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {product.tulipProductId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={disableRowActions || isPushPending}
                          onClick={async () => {
                            void onPushProduct({
                              productId: product.id,
                              productType: draft.productType.trim() || null,
                              brand: draft.brand.trim() || null,
                              model: draft.model.trim() || null,
                              valueExcl: hasInvalidValueExcl ? null : parsedValueExcl,
                            })
                          }}
                        >
                          {isPushPending && pushProductId === product.id
                            ? t('updatingButton')
                            : t('updateButton')}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={disableRowActions || isCreatePending}
                          onClick={async () => {
                            void onCreateProduct({
                              productId: product.id,
                              productType: draft.productType.trim() || null,
                              brand: draft.brand.trim() || null,
                              model: draft.model.trim() || null,
                              valueExcl: hasInvalidValueExcl ? null : parsedValueExcl,
                            })
                          }}
                        >
                          {isCreatePending && createProductId === product.id
                            ? t('creatingButton')
                            : t('createButton')}
                        </Button>
                      )}
                      {isMappingPending && mappingProductId === product.id && (
                        <p className="mt-1 text-xs text-muted-foreground">{t('savingMapping')}</p>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void onRefresh()
            }}
            disabled={isRefreshing}
          >
            {isRefreshing ? t('refreshingButton') : t('refreshButton')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
