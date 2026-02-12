'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Minus, Plus, ShoppingCart, ImageIcon, ChevronLeft, ChevronRight, TrendingDown, Play } from 'lucide-react'
import { toastManager } from '@louez/ui'

import { Button } from '@louez/ui'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import {
  allocateAcrossCombinations,
  cn,
  formatCurrency,
  getMaxAvailableForSelection,
  getTotalAvailableForSelection,
} from '@louez/utils'
import { useCart } from '@/contexts/cart-context'
import { useStoreCurrency } from '@/contexts/store-context'
import { useAnalytics } from '@/contexts/analytics-context'
import { calculateDuration, getDetailedDuration, type PricingMode } from '@/lib/utils/duration'
import {
  calculateRentalPrice,
  calculateEffectivePrice,
  sortTiersByDuration,
  type ProductPricing,
} from '@louez/utils'
import { AccessoriesModal } from './accessories-modal'
import type { CombinationAvailability } from '@louez/types'

function normalizeSelectionValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function buildSelectionSignature(attributes: Record<string, string>): string {
  const entries = Object.entries(attributes)
    .map(([key, value]) => [key.trim().toLowerCase(), normalizeSelectionValue(value)] as const)
    .filter(([key, value]) => Boolean(key) && Boolean(value))
    .sort((a, b) => a[0].localeCompare(b[0], 'en'))

  if (entries.length === 0) {
    return '__default'
  }

  return entries.map(([key, value]) => `${key}:${value}`).join('|')
}

interface PricingTier {
  id: string
  minDuration: number
  discountPercent: number | string
}

interface Accessory {
  id: string
  name: string
  price: string
  deposit: string
  images: string[] | null
  quantity: number
  pricingMode: PricingMode | null
  pricingTiers?: PricingTier[]
}

// Helper function to extract YouTube video ID from URL
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/shorts\/)([^&?/]+)/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

interface ProductModalProps {
  product: {
    id: string
    name: string
    description: string | null
    images: string[] | null
    price: string
    deposit: string | null
    quantity: number
    category?: { name: string } | null
    pricingMode?: PricingMode | null
    pricingTiers?: PricingTier[]
    videoUrl?: string | null
    accessories?: Accessory[]
    trackUnits?: boolean | null
    bookingAttributeAxes?: Array<{ key: string; label: string; position: number }> | null
    units?: Array<{
      status: 'available' | 'maintenance' | 'retired' | null
      attributes: Record<string, string> | null
    }>
  }
  isOpen: boolean
  onClose: () => void
  storeSlug: string
  pricingMode: PricingMode
  availableQuantity: number
  startDate: string
  endDate: string
  availableCombinations?: CombinationAvailability[]
}

export function ProductModal({
  product,
  isOpen,
  onClose,
  storeSlug,
  pricingMode,
  availableQuantity,
  startDate,
  endDate,
  availableCombinations = [],
}: ProductModalProps) {
  const t = useTranslations('storefront.productModal')
  const tProduct = useTranslations('storefront.product')
  const currency = useStoreCurrency()
  const {
    addItem,
    updateItemQuantityByLineId,
    getProductQuantityInCart,
    items: cartItems,
  } = useCart()
  const { trackEvent } = useAnalytics()

  const cartLines = useMemo(
    () => cartItems.filter((item) => item.productId === product.id),
    [cartItems, product.id],
  )
  const wasOpenRef = useRef(false)
  const [quantity, setQuantity] = useState(1)
  const [selectedImageIndex, setSelectedImageIndex] = useState(0)
  const [accessoriesModalOpen, setAccessoriesModalOpen] = useState(false)
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string>>({})

  // Filter available accessories (active with stock and not already in cart)
  const cartProductIds = new Set(cartItems.map((item) => item.productId))
  const availableAccessories = (product.accessories || []).filter(
    (acc) => acc.quantity > 0 && !cartProductIds.has(acc.id)
  )

  useEffect(() => {
    const isOpening = isOpen && !wasOpenRef.current
    wasOpenRef.current = isOpen

    if (!isOpening) return

    setSelectedImageIndex(0)
    if (cartLines.length === 1) {
      setSelectedAttributes(cartLines[0].selectedAttributes || {})
    } else {
      setSelectedAttributes({})
    }
    setQuantity(1)
    // Track product view when modal opens
    trackEvent({
      eventType: 'product_view',
      metadata: {
        productId: product.id,
        productName: product.name,
        price: product.price,
        categoryName: product.category?.name,
      },
    })
  }, [isOpen, cartLines, trackEvent, product.id, product.name, product.price, product.category?.name])

  const price = parseFloat(product.price)
  const deposit = product.deposit ? parseFloat(product.deposit) : 0
  const effectivePricingMode = product.pricingMode ?? 'day'
  const duration = calculateDuration(startDate, endDate, effectivePricingMode)
  const { days, hours } = getDetailedDuration(startDate, endDate)

  // Calculate with tiered pricing - normalize discountPercent to number
  const tiers = product.pricingTiers?.map((tier, index) => ({
    id: tier.id,
    minDuration: tier.minDuration,
    discountPercent: typeof tier.discountPercent === 'string'
      ? parseFloat(tier.discountPercent)
      : tier.discountPercent,
    displayOrder: index,
  })) || []

  const pricing: ProductPricing = {
    basePrice: price,
    deposit,
    pricingMode: effectivePricingMode,
    tiers,
  }
  const priceResult = calculateRentalPrice(pricing, duration, quantity)
  const totalPrice = priceResult.subtotal
  const originalPrice = priceResult.originalSubtotal
  const savings = priceResult.savings
  const discountPercent = priceResult.discountPercent

  const maxQuantity = Math.min(availableQuantity, product.quantity)
  const isUnavailable = availableQuantity === 0
  const bookingAttributeAxes = (product.bookingAttributeAxes || [])
    .slice()
    .sort((a, b) => a.position - b.position)
  const fallbackAttributeValues = bookingAttributeAxes.reduce<Record<string, string[]>>((acc, axis) => {
    const values = new Set<string>()
    for (const unit of product.units || []) {
      if ((unit.status || 'available') !== 'available') continue
      const value = unit.attributes?.[axis.key]
      if (value && value.trim()) {
        values.add(value.trim())
      }
    }
    acc[axis.key] = [...values].sort((a, b) => a.localeCompare(b, 'en'))
    return acc
  }, {})
  const bookingAttributeValues = bookingAttributeAxes.reduce<Record<string, string[]>>((acc, axis) => {
    const values = new Set<string>()
    for (const combination of availableCombinations) {
      if (combination.availableQuantity <= 0) continue
      const value = combination.selectedAttributes?.[axis.key]
      if (value && value.trim()) {
        values.add(value.trim())
      }
    }
    for (const fallbackValue of fallbackAttributeValues[axis.key] || []) {
      values.add(fallbackValue)
    }
    acc[axis.key] = [...values].sort((a, b) => a.localeCompare(b, 'en'))
    return acc
  }, {})
  const hasBookingAttributes = bookingAttributeAxes.length > 0
  const selectionSignature = useMemo(
    () => buildSelectionSignature(selectedAttributes),
    [selectedAttributes],
  )
  const hasExplicitSelection = Object.keys(selectedAttributes).length > 0
  const matchingCartLine = cartLines.find((line) => line.selectionSignature === selectionSignature)
  const isInCart = Boolean(matchingCartLine)
  const productCartQuantity = getProductQuantityInCart(product.id)
  const selectionMaxQuantity = hasBookingAttributes
    ? (
        (availableCombinations.length > 0
          ? (
              hasExplicitSelection
                ? getMaxAvailableForSelection(availableCombinations, selectedAttributes)
                : getTotalAvailableForSelection(availableCombinations, selectedAttributes)
            )
          : maxQuantity)
      )
    : maxQuantity
  const effectiveMaxQuantity = Math.min(maxQuantity, selectionMaxQuantity)
  const isSelectionUnavailable = hasBookingAttributes && effectiveMaxQuantity === 0

  const images = product.images && product.images.length > 0 ? product.images : []

  // Video handling
  const videoId = product.videoUrl ? extractYouTubeVideoId(product.videoUrl) : null
  const hasVideo = !!videoId

  // Total media items count (images + video)
  const totalMediaItems = images.length + (hasVideo ? 1 : 0)
  const isVideoSelected = hasVideo && selectedImageIndex === images.length

  const handleQuantityChange = (delta: number) => {
    const cap = Math.max(1, effectiveMaxQuantity)
    const newQty = Math.max(1, Math.min(quantity + delta, cap))
    setQuantity(newQty)
  }

  useEffect(() => {
    if (!isOpen) return

    if (matchingCartLine) {
      setQuantity(Math.min(matchingCartLine.quantity, Math.max(1, effectiveMaxQuantity)))
      return
    }

    if (effectiveMaxQuantity > 0 && quantity > effectiveMaxQuantity) {
      setQuantity(effectiveMaxQuantity)
    }
  }, [isOpen, matchingCartLine, effectiveMaxQuantity, quantity])

  const handleAddToCart = () => {
    if (hasBookingAttributes && effectiveMaxQuantity <= 0) {
      return
    }

    if (hasBookingAttributes && !hasExplicitSelection && availableCombinations.length > 0) {
      const allocations = allocateAcrossCombinations(
        bookingAttributeAxes,
        availableCombinations,
        selectedAttributes,
        quantity,
      )

      if (!allocations || allocations.length === 0) {
        return
      }

      for (const allocation of allocations) {
        addItem(
          {
            productId: product.id,
            productName: product.name,
            productImage: images[0] || null,
            price,
            deposit,
            quantity: allocation.quantity,
            maxQuantity: Math.max(1, allocation.combination.availableQuantity),
            pricingMode: effectivePricingMode,
            pricingTiers: product.pricingTiers?.map((tier) => ({
              id: tier.id,
              minDuration: tier.minDuration,
              discountPercent: typeof tier.discountPercent === 'string'
                ? parseFloat(tier.discountPercent)
                : tier.discountPercent,
            })),
            productPricingMode: product.pricingMode,
            selectedAttributes: allocation.combination.selectedAttributes,
          },
          storeSlug,
        )
      }

      trackEvent({
        eventType: 'add_to_cart',
        metadata: {
          productId: product.id,
          productName: product.name,
          quantity,
          price: product.price,
          totalPrice,
          categoryName: product.category?.name,
        },
      })

      if (availableAccessories.length > 0) {
        onClose()
        setAccessoriesModalOpen(true)
      } else {
        toastManager.add({ title: tProduct('addedToCart', { name: product.name }), type: 'success' })
        onClose()
      }
      return
    }

    if (matchingCartLine) {
      updateItemQuantityByLineId(matchingCartLine.lineId, quantity)
      // Track update quantity event
      trackEvent({
        eventType: 'update_quantity',
        metadata: {
          productId: product.id,
          productName: product.name,
          quantity,
          price: product.price,
        },
      })
      toastManager.add({ title: tProduct('addedToCart', { name: product.name }), type: 'success' })
      onClose()
    } else {
      addItem(
        {
          productId: product.id,
          productName: product.name,
          productImage: images[0] || null,
          price,
          deposit,
          quantity,
          maxQuantity: Math.max(1, effectiveMaxQuantity),
          pricingMode: effectivePricingMode,
          pricingTiers: product.pricingTiers?.map((tier) => ({
            id: tier.id,
            minDuration: tier.minDuration,
            discountPercent: typeof tier.discountPercent === 'string'
              ? parseFloat(tier.discountPercent)
              : tier.discountPercent,
          })),
          productPricingMode: product.pricingMode,
          selectedAttributes,
        },
        storeSlug
      )

      // Track add to cart event
      trackEvent({
        eventType: 'add_to_cart',
        metadata: {
          productId: product.id,
          productName: product.name,
          quantity,
          price: product.price,
          totalPrice,
          categoryName: product.category?.name,
        },
      })

      // Show accessories modal if there are available accessories, otherwise show toast
      if (availableAccessories.length > 0) {
        onClose()
        setAccessoriesModalOpen(true)
      } else {
        toastManager.add({ title: tProduct('addedToCart', { name: product.name }), type: 'success' })
        onClose()
      }
    }
  }

  // Duration label
  const durationLabel = (() => {
    if (effectivePricingMode === 'hour') return `${days * 24 + hours}h`
    if (days === 0) return `${hours}h`
    if (hours === 0) return `${days}j`
    return `${days}j ${hours}h`
  })()

  // Pricing unit labels
  const pricingUnitLabel =
    effectivePricingMode === 'hour'
      ? tProduct('pricingUnit.hour.singular')
      : effectivePricingMode === 'week'
        ? tProduct('pricingUnit.week.singular')
        : tProduct('pricingUnit.day.singular')

  const pricingUnitLabelPlural =
    effectivePricingMode === 'hour'
      ? tProduct('pricingUnit.hour.plural')
      : effectivePricingMode === 'week'
        ? tProduct('pricingUnit.week.plural')
        : tProduct('pricingUnit.day.plural')

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedImageIndex((prev) => (prev === 0 ? totalMediaItems - 1 : prev - 1))
  }

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedImageIndex((prev) => (prev === totalMediaItems - 1 ? 0 : prev + 1))
  }

  // Sort tiers for display
  const sortedTiers = tiers.length > 0 ? sortTiersByDuration(tiers) : []

  return (
  <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>

        {/* Scrollable container for image + content */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ===== IMAGE SECTION (top) ===== */}
          <div className="relative w-full bg-muted/30">
            {/* Main image/video - 4:3 aspect ratio */}
            <div className="relative aspect-[4/3] w-full">
              {totalMediaItems > 0 ? (
                <>
                  {/* Show video if video is selected */}
                  {isVideoSelected && videoId ? (
                    <iframe
                      src={`https://www.youtube.com/embed/${videoId}?autoplay=0&rel=0`}
                      title={product.name}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0 w-full h-full"
                    />
                  ) : images.length > 0 ? (
                    <Image
                      src={images[selectedImageIndex]}
                      alt={product.name}
                      fill
                      className="object-contain"
                      sizes="(max-width: 768px) 95vw, 672px"
                      priority
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="h-16 w-16 text-muted-foreground/30" />
                    </div>
                  )}

                  {/* Navigation arrows */}
                  {totalMediaItems > 1 && (
                    <>
                      <button
                        onClick={handlePrevImage}
                        className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/90 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors shadow-md z-10"
                        aria-label="Image précédente"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={handleNextImage}
                        className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-background/90 backdrop-blur-sm flex items-center justify-center hover:bg-background transition-colors shadow-md z-10"
                        aria-label="Image suivante"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}

                  {/* Media counter badge */}
                  {totalMediaItems > 1 && (
                    <div className="absolute bottom-3 right-3 px-3 py-1.5 rounded-full bg-background/90 backdrop-blur-sm text-sm font-medium shadow-md">
                      {selectedImageIndex + 1} / {totalMediaItems}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <ImageIcon className="h-16 w-16 text-muted-foreground/30" />
                </div>
              )}
            </div>

            {/* Thumbnails strip */}
            {totalMediaItems > 1 && (
              <div className="flex justify-center gap-2 p-3 bg-background/50 border-b">
                {/* Image thumbnails */}
                {images.slice(0, hasVideo ? 5 : 6).map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImageIndex(idx)}
                    className={cn(
                      'relative h-14 w-14 rounded-lg overflow-hidden shrink-0 transition-all border-2',
                      selectedImageIndex === idx
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-transparent opacity-70 hover:opacity-100'
                    )}
                  >
                    <Image
                      src={img}
                      alt={`${product.name} - ${idx + 1}`}
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                  </button>
                ))}

                {/* More images indicator */}
                {images.length > (hasVideo ? 5 : 6) && (
                  <div className="flex items-center justify-center h-14 w-14 rounded-lg bg-muted text-muted-foreground text-sm font-medium">
                    +{images.length - (hasVideo ? 5 : 6)}
                  </div>
                )}

                {/* Video thumbnail */}
                {hasVideo && videoId && (
                  <button
                    onClick={() => setSelectedImageIndex(images.length)}
                    className={cn(
                      'relative h-14 w-14 rounded-lg overflow-hidden shrink-0 transition-all border-2',
                      isVideoSelected
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-transparent opacity-70 hover:opacity-100'
                    )}
                  >
                    {/* YouTube thumbnail */}
                    <Image
                      src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                      alt="Vidéo"
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                    {/* Play icon overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Play className="h-5 w-5 text-white fill-white" />
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ===== CONTENT SECTION ===== */}
          <div className="p-5 md:p-6">

            {/* Header: Category + Name + Stock */}
            <div className="mb-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  {product.category && (
                    <p className="text-sm text-muted-foreground mb-1">{product.category.name}</p>
                  )}
                  <h2 className="text-xl md:text-2xl font-semibold leading-tight">{product.name}</h2>
                </div>
                <Badge
                  variant={isUnavailable ? 'error' : 'secondary'}
                  className="shrink-0 text-xs"
                >
                  {availableQuantity} {t('stock', { count: availableQuantity }).replace(/^\d+\s*/, '')}
                </Badge>
              </div>

              {/* Base price per unit - prominent display */}
              <div className="flex items-baseline gap-2 mt-3">
                <span className="text-2xl md:text-3xl font-bold text-primary">
                  {formatCurrency(price, currency)}
                </span>
                <span className="text-muted-foreground text-base">/ {pricingUnitLabel}</span>
              </div>
            </div>

            {/* Description */}
            {product.description && (
              <div className="mb-5 pb-5 border-b">
                <div
                  className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none
                             [&>*]:break-words [&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_li]:mb-1
                             [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm"
                  style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              </div>
            )}

            {/* Pricing tiers section */}
            {sortedTiers.length > 0 && (
              <div className="rounded-xl border bg-gradient-to-br from-green-50/50 to-emerald-50/30 dark:from-green-950/20 dark:to-emerald-950/10 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-900/40">
                    <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="font-semibold text-sm">{tProduct('tieredPricing.ratesTitle')}</span>
                </div>

                <div className="space-y-1.5">
                  {/* Base price row */}
                  <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-background/60">
                    <span className="text-muted-foreground">1 {pricingUnitLabel}</span>
                    <span className="font-medium">{formatCurrency(price, currency)}</span>
                  </div>

                  {/* Tier rows */}
                  {sortedTiers.map((tier) => {
                    const effectivePrice = calculateEffectivePrice(price, tier)
                    const isCurrentTier = duration >= tier.minDuration &&
                      !sortedTiers.some(t => t.minDuration > tier.minDuration && duration >= t.minDuration)

                    return (
                      <div
                        key={tier.id}
                        className={cn(
                          'flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors',
                          isCurrentTier
                            ? 'bg-green-100 dark:bg-green-900/40 ring-1 ring-green-300 dark:ring-green-700'
                            : 'bg-background/60'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('font-medium', isCurrentTier && 'text-green-700 dark:text-green-300')}>
                            {tier.minDuration}+ {pricingUnitLabelPlural}
                          </span>
                          <Badge
                            className={cn(
                              'text-xs font-semibold',
                              isCurrentTier
                                ? 'bg-green-600 text-white hover:bg-green-600'
                                : 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300'
                            )}
                          >
                            -{tier.discountPercent}%
                          </Badge>
                        </div>
                        <span className={cn('font-semibold', isCurrentTier && 'text-green-700 dark:text-green-300')}>
                          {formatCurrency(effectivePrice, currency)}/{pricingUnitLabel}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Booking attributes */}
            {bookingAttributeAxes.length > 0 && (
              <div className="mt-5 rounded-xl border p-4">
                <p className="mb-3 text-sm font-medium">{tProduct('bookingAttributes')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {bookingAttributeAxes.map((axis) => (
                    <Select
                      key={axis.key}
                      value={selectedAttributes[axis.key] || '__none__'}
                      onValueChange={(value) => {
                        setSelectedAttributes((prev) => {
                          if (!value || value === '__none__') {
                            const next = { ...prev }
                            delete next[axis.key]
                            return next
                          }

                          return { ...prev, [axis.key]: value }
                        })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={axis.label}>
                          {selectedAttributes[axis.key] || axis.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" label={tProduct('bookingAttributeNone')}>
                          {tProduct('bookingAttributeNone')}
                        </SelectItem>
                        {(bookingAttributeValues[axis.key] || []).length > 0 ? (
                          (bookingAttributeValues[axis.key] || []).map((value) => (
                            <SelectItem key={value} value={value} label={value}>
                              {value}
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value={`__empty_${axis.key}`} label={axis.label} disabled>
                            {tProduct('bookingAttributesNoOptions', { attribute: axis.label })}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  ))}
                </div>
                <p className="text-muted-foreground mt-2 text-xs">{tProduct('bookingAttributesHelp')}</p>
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium">
                    {tProduct('availableForSelection', { count: effectiveMaxQuantity })}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {tProduct('quantityPerCombinationHint')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== FOOTER - Always visible at bottom ===== */}
        <div className="shrink-0 border-t bg-background p-4 md:p-5">

          {/* Price summary row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">
                {tProduct('total')} ({durationLabel})
              </span>
              <div className="flex items-baseline gap-2 mt-0.5">
                {savings > 0 && (
                  <span className="text-sm line-through text-muted-foreground">
                    {formatCurrency(originalPrice, currency)}
                  </span>
                )}
                <span className="text-2xl font-bold text-primary">
                  {formatCurrency(totalPrice, currency)}
                </span>
              </div>
            </div>

            {savings > 0 && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 text-sm font-semibold px-3 py-1">
                -{discountPercent}%
              </Badge>
            )}
          </div>

          {/* Quantity and CTA row */}
          <div className="flex items-center gap-3">
            {/* Quantity selector */}
            <div className="flex items-center bg-muted rounded-xl p-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-lg hover:bg-background"
                onClick={() => handleQuantityChange(-1)}
                disabled={quantity <= 1 || isUnavailable}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center font-semibold text-lg tabular-nums">{quantity}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-lg hover:bg-background"
                onClick={() => handleQuantityChange(1)}
                disabled={quantity >= effectiveMaxQuantity || isUnavailable || isSelectionUnavailable}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {/* Add to cart button */}
            <Button
              onClick={handleAddToCart}
              disabled={isUnavailable || isSelectionUnavailable}
              size="lg"
              className="flex-1 h-12 text-base font-semibold rounded-xl"
            >
              <ShoppingCart className="h-5 w-5 mr-2" />
              {isInCart ? t('updateCart') : t('addToCart')}
            </Button>
          </div>
          {productCartQuantity > 0 && (
            <p className="text-muted-foreground mt-2 text-xs">
              {tProduct('inCartCount', { count: productCartQuantity })}
            </p>
          )}
        </div>
      </DialogPopup>
    </Dialog>

    {/* Accessories Modal */}
    <AccessoriesModal
      open={accessoriesModalOpen}
      onOpenChange={setAccessoriesModalOpen}
      productName={product.name}
      accessories={availableAccessories.map((acc) => ({
        ...acc,
        pricingTiers: acc.pricingTiers?.map((tier) => ({
          id: tier.id,
          minDuration: tier.minDuration,
          discountPercent: typeof tier.discountPercent === 'string'
            ? tier.discountPercent
            : tier.discountPercent.toString(),
        })),
      }))}
      storeSlug={storeSlug}
      currency={currency}
    />
  </>
  )
}
