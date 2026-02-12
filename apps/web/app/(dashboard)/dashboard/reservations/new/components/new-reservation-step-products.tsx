'use client'

import {
  AlertTriangle,
  ImageIcon,
  Minus,
  Package,
  PackageX,
  PenLine,
  Plus,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'

import type { PricingMode } from '@louez/types'

import type {
  AvailabilityWarning,
  CustomItem,
  Product,
  ProductPricingDetails,
  SelectedProduct,
} from '../types'

interface NewReservationStepProductsProps {
  products: Product[]
  selectedProducts: SelectedProduct[]
  customItems: CustomItem[]
  startDate: Date | undefined
  endDate: Date | undefined
  availabilityWarnings: AvailabilityWarning[]
  hasItems: boolean
  subtotal: number
  originalSubtotal: number
  totalSavings: number
  deposit: number
  addProduct: (productId: string) => void
  updateQuantity: (productId: string, delta: number) => void
  onOpenCustomItemDialog: () => void
  updateCustomItemQuantity: (id: string, delta: number) => void
  removeCustomItem: (id: string) => void
  openPriceOverrideDialog: (
    productId: string,
    calculatedPrice: number,
    pricingMode: PricingMode,
    duration: number
  ) => void
  calculateDurationForMode: (startDate: Date, endDate: Date, mode: PricingMode) => number
  getProductPricingDetails: (
    product: Product,
    selectedItem?: SelectedProduct
  ) => ProductPricingDetails
  getCustomItemTotal: (item: CustomItem) => number
}

export function NewReservationStepProducts({
  products,
  selectedProducts,
  customItems,
  startDate,
  endDate,
  availabilityWarnings,
  hasItems,
  subtotal,
  originalSubtotal,
  totalSavings,
  deposit,
  addProduct,
  updateQuantity,
  onOpenCustomItemDialog,
  updateCustomItemQuantity,
  removeCustomItem,
  openPriceOverrideDialog,
  calculateDurationForMode,
  getProductPricingDetails,
  getCustomItemTotal,
}: NewReservationStepProductsProps) {
  const t = useTranslations('dashboard.reservations.manualForm')
  const tCommon = useTranslations('common')

  const getPricingUnitLabel = (mode: PricingMode) => {
    if (mode === 'hour') return t('perHour')
    if (mode === 'week') return t('perWeek')
    return t('perDay')
  }

  const getDurationLabel = (mode: PricingMode, count: number) => {
    if (mode === 'hour') return tCommon('hourUnit', { count })
    if (mode === 'week') return tCommon('weekUnit', { count })
    return tCommon('dayUnit', { count })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          {t('products')}
        </CardTitle>
        <CardDescription>{t('productsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {products.map((product) => {
            const selectedItem = selectedProducts.find((sp) => sp.productId === product.id)
            const selectedQuantity = selectedItem?.quantity || 0
            const isOutOfStock = product.quantity === 0
            const remainingStock = product.quantity - selectedQuantity
            const canAddMore = remainingStock > 0

            const pricingDetails = getProductPricingDetails(product, selectedItem)
            const {
              productPricingMode,
              productDuration,
              basePrice,
              calculatedPrice,
              effectivePrice,
              hasPriceOverride,
              hasDiscount,
              applicableTierDiscountPercent,
              hasTieredPricing,
            } = pricingDetails

            return (
              <div
                key={product.id}
                className={cn(
                  'rounded-lg border p-4 transition-colors',
                  isOutOfStock && 'bg-muted/30 opacity-60',
                  selectedQuantity > 0 && 'border-primary bg-primary/5'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                      {product.images && product.images.length > 0 ? (
                        // Product thumbnails already use direct URLs in this feature.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.images[0]}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{product.name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {hasPriceOverride ? (
                          <>
                            <span className="text-sm text-muted-foreground line-through">
                              {formatCurrency(calculatedPrice)}/{getPricingUnitLabel(productPricingMode)}
                            </span>
                            <span
                              className={cn(
                                'text-sm font-medium',
                                effectivePrice < calculatedPrice
                                  ? 'text-green-600'
                                  : 'text-orange-600'
                              )}
                            >
                              {formatCurrency(effectivePrice)}/{getPricingUnitLabel(productPricingMode)}
                            </span>
                            <Badge
                              variant="secondary"
                              className={cn(
                                'text-xs',
                                effectivePrice < calculatedPrice
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-orange-100 text-orange-700'
                              )}
                            >
                              {t('priceOverride.modified')}
                            </Badge>
                          </>
                        ) : hasDiscount ? (
                          <>
                            <span className="text-sm text-muted-foreground line-through">
                              {formatCurrency(basePrice)}/{getPricingUnitLabel(productPricingMode)}
                            </span>
                            <span className="text-sm font-medium text-green-600">
                              {formatCurrency(effectivePrice)}/{getPricingUnitLabel(productPricingMode)}
                            </span>
                            <Badge variant="secondary" className="bg-green-100 text-xs text-green-700">
                              -{applicableTierDiscountPercent}%
                            </Badge>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {formatCurrency(basePrice)}/{getPricingUnitLabel(productPricingMode)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {isOutOfStock ? (
                          <Badge variant="error" className="text-xs">
                            {t('outOfStock')}
                          </Badge>
                        ) : (
                          <span
                            className={cn(
                              'text-xs',
                              remainingStock <= 2 ? 'text-orange-600' : 'text-muted-foreground'
                            )}
                          >
                            {remainingStock} {t('available')}
                          </span>
                        )}
                        {hasTieredPricing && !hasDiscount && (
                          <span className="text-xs text-muted-foreground">• {t('tieredPricing')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {selectedQuantity > 0 ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity(product.id, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-medium">{selectedQuantity}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => updateQuantity(product.id, 1)}
                          disabled={!canAddMore}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant={isOutOfStock ? 'ghost' : 'outline'}
                        onClick={() => addProduct(product.id)}
                        disabled={isOutOfStock}
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        {t('add')}
                      </Button>
                    )}
                  </div>
                </div>
                {selectedQuantity > 0 && productDuration > 0 && (
                  <div className="mt-3 border-t pt-3">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {selectedQuantity} × {productDuration}{' '}
                          {getDurationLabel(productPricingMode, productDuration)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            openPriceOverrideDialog(
                              product.id,
                              calculatedPrice,
                              productPricingMode,
                              productDuration
                            )
                          }
                        >
                          <PenLine className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-right">
                        {hasPriceOverride ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground line-through">
                              {formatCurrency(calculatedPrice * selectedQuantity * productDuration)}
                            </span>
                            <span
                              className={cn(
                                'font-medium',
                                effectivePrice < calculatedPrice
                                  ? 'text-green-600'
                                  : 'text-orange-600'
                              )}
                            >
                              {formatCurrency(effectivePrice * selectedQuantity * productDuration)}
                            </span>
                          </div>
                        ) : hasDiscount ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground line-through">
                              {formatCurrency(basePrice * selectedQuantity * productDuration)}
                            </span>
                            <span className="font-medium text-green-600">
                              {formatCurrency(effectivePrice * selectedQuantity * productDuration)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-medium">
                            {formatCurrency(basePrice * selectedQuantity * productDuration)}
                          </span>
                        )}
                      </div>
                    </div>
                    {(hasDiscount || hasPriceOverride) && (
                      <div className="mt-1 flex justify-end">
                        <span
                          className={cn(
                            'text-xs',
                            effectivePrice < calculatedPrice || effectivePrice < basePrice
                              ? 'text-green-600'
                              : 'text-orange-600'
                          )}
                        >
                          {effectivePrice < (hasPriceOverride ? calculatedPrice : basePrice)
                            ? `${t('savings')}: ${formatCurrency(((hasPriceOverride ? calculatedPrice : basePrice) - effectivePrice) * selectedQuantity * productDuration)}`
                            : `+${formatCurrency((effectivePrice - calculatedPrice) * selectedQuantity * productDuration)}`}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {products.length === 0 && customItems.length === 0 && (
          <div className="py-8 text-center">
            <ShoppingCart className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">{t('noProducts')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('noProductsHint')}</p>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <PenLine className="h-4 w-4" />
              {t('customItem.title')}
            </h4>
            <Button type="button" variant="outline" onClick={onOpenCustomItemDialog}>
              <Plus className="mr-1 h-4 w-4" />
              {t('customItem.add')}
            </Button>
          </div>

          {customItems.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {customItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{item.name}</p>
                        <Badge variant="secondary" className="text-xs">
                          {t('customItem.badge')}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {formatCurrency(item.unitPrice)}/
                        {item.pricingMode === 'hour'
                          ? t('perHour')
                          : item.pricingMode === 'week'
                            ? 'week'
                            : t('perDay')}
                      </p>
                      {item.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCustomItemQuantity(item.id, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-8 text-center font-medium">{item.quantity}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateCustomItemQuantity(item.id, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => removeCustomItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  {startDate && endDate && (
                    <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
                      <span className="text-muted-foreground">
                        {item.quantity} × {calculateDurationForMode(startDate, endDate, item.pricingMode)}{' '}
                        {item.pricingMode === 'hour' ? 'h' : item.pricingMode === 'week' ? 'sem' : 'j'}
                      </span>
                      <span className="font-medium">{formatCurrency(getCustomItemTotal(item))}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {customItems.length === 0 && (
            <p className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
              {t('customItem.empty')}
            </p>
          )}
        </div>

        {availabilityWarnings.length > 0 && (
          <div className="space-y-2">
            {availabilityWarnings.map((warning) => (
              <Alert
                key={warning.productId}
                className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
              >
                <PackageX className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                <AlertDescription className="ml-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-amber-800 dark:text-amber-200">
                      {t('warnings.productConflict', { name: warning.productName })}
                    </span>
                    <span className="text-sm text-amber-700 dark:text-amber-300">
                      {t('warnings.productConflictDetails', {
                        requested: warning.requestedQuantity,
                        available: warning.availableQuantity,
                      })}
                    </span>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              {t('warnings.conflictCanContinue')}
            </p>
          </div>
        )}

        {hasItems && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-4">
            {totalSavings > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('originalPrice')}</span>
                <span className="text-muted-foreground line-through">
                  {formatCurrency(originalSubtotal)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('subtotal')}</span>
              <span className={totalSavings > 0 ? 'font-medium text-green-600' : ''}>
                {formatCurrency(subtotal)}
              </span>
            </div>
            {totalSavings > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-green-600">{t('totalSavings')}</span>
                <span className="font-medium text-green-600">-{formatCurrency(totalSavings)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('deposit')}</span>
              <span>{formatCurrency(deposit)}</span>
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between font-medium">
              <span>{t('total')}</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
