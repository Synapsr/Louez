'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import Image from 'next/image';

import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Minus,
  Play,
  Plus,
  ShoppingCart,
  TrendingDown,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { CombinationAvailability } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from '@louez/ui';
import { Badge } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import {
  allocateAcrossCombinations,
  buildCombinationKey,
  cn,
  formatCurrency,
  getDeterministicCombinationSortValue,
  getSelectionCapacity,
} from '@louez/utils';
import {
  type ProductPricing,
  calculateEffectivePrice,
  calculateRentalPrice,
  sortTiersByDuration,
} from '@louez/utils';

import {
  type PricingMode,
  calculateDuration,
  getDetailedDuration,
} from '@/lib/utils/duration';

import { useAnalytics } from '@/contexts/analytics-context';
import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

import { AccessoriesModal } from './accessories-modal';

function normalizeSelectionValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function buildSelectionSignature(attributes: Record<string, string>): string {
  const entries = Object.entries(attributes)
    .map(
      ([key, value]) =>
        [key.trim().toLowerCase(), normalizeSelectionValue(value)] as const,
    )
    .filter(([key, value]) => Boolean(key) && Boolean(value))
    .sort((a, b) => a[0].localeCompare(b[0], 'en'));

  if (entries.length === 0) {
    return '__default';
  }

  return entries.map(([key, value]) => `${key}:${value}`).join('|');
}

interface PricingTier {
  id: string;
  minDuration: number;
  discountPercent: number | string;
}

interface Accessory {
  id: string;
  name: string;
  price: string;
  deposit: string;
  images: string[] | null;
  quantity: number;
  pricingMode: PricingMode | null;
  pricingTiers?: PricingTier[];
}

// Helper function to extract YouTube video ID from URL
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/shorts\/)([^&?/]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

interface ProductModalProps {
  product: {
    id: string;
    name: string;
    description: string | null;
    images: string[] | null;
    price: string;
    deposit: string | null;
    quantity: number;
    category?: { name: string } | null;
    pricingMode?: PricingMode | null;
    pricingTiers?: PricingTier[];
    videoUrl?: string | null;
    accessories?: Accessory[];
    trackUnits?: boolean | null;
    bookingAttributeAxes?: Array<{
      key: string;
      label: string;
      position: number;
    }> | null;
    units?: Array<{
      status: 'available' | 'maintenance' | 'retired' | null;
      attributes: Record<string, string> | null;
    }>;
  };
  isOpen: boolean;
  onClose: () => void;
  storeSlug: string;
  availableQuantity: number;
  startDate: string;
  endDate: string;
  availableCombinations?: CombinationAvailability[];
}

export function ProductModal({
  product,
  isOpen,
  onClose,
  storeSlug,
  availableQuantity,
  startDate,
  endDate,
  availableCombinations = [],
}: ProductModalProps) {
  const t = useTranslations('storefront.productModal');
  const tProduct = useTranslations('storefront.product');
  const currency = useStoreCurrency();
  const {
    addItem,
    updateItemQuantityByLineId,
    getProductQuantityInCart,
    items: cartItems,
  } = useCart();
  const { trackEvent } = useAnalytics();

  const cartLines = useMemo(
    () => cartItems.filter((item) => item.productId === product.id),
    [cartItems, product.id],
  );
  const wasOpenRef = useRef(false);
  const [quantity, setQuantity] = useState(1);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [accessoriesModalOpen, setAccessoriesModalOpen] = useState(false);
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >({});

  // Filter available accessories (active with stock and not already in cart)
  const cartProductIds = new Set(cartItems.map((item) => item.productId));
  const availableAccessories = (product.accessories || []).filter(
    (acc) => acc.quantity > 0 && !cartProductIds.has(acc.id),
  );

  useEffect(() => {
    const isOpening = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!isOpening) return;

    setSelectedImageIndex(0);
    if (cartLines.length === 1) {
      setSelectedAttributes(cartLines[0].selectedAttributes || {});
    } else {
      setSelectedAttributes({});
    }
    setQuantity(1);
    // Track product view when modal opens
    trackEvent({
      eventType: 'product_view',
      metadata: {
        productId: product.id,
        productName: product.name,
        price: product.price,
        categoryName: product.category?.name,
      },
    });
  }, [
    isOpen,
    cartLines,
    trackEvent,
    product.id,
    product.name,
    product.price,
    product.category?.name,
  ]);

  const price = parseFloat(product.price);
  const deposit = product.deposit ? parseFloat(product.deposit) : 0;
  const effectivePricingMode = product.pricingMode ?? 'day';
  const duration = calculateDuration(startDate, endDate, effectivePricingMode);
  const { days, hours } = getDetailedDuration(startDate, endDate);

  // Calculate with tiered pricing - normalize discountPercent to number
  const tiers =
    product.pricingTiers?.map((tier, index) => ({
      id: tier.id,
      minDuration: tier.minDuration,
      discountPercent:
        typeof tier.discountPercent === 'string'
          ? parseFloat(tier.discountPercent)
          : tier.discountPercent,
      displayOrder: index,
    })) || [];

  const pricing: ProductPricing = {
    basePrice: price,
    deposit,
    pricingMode: effectivePricingMode,
    tiers,
  };
  const priceResult = calculateRentalPrice(pricing, duration, quantity);
  const totalPrice = priceResult.subtotal;
  const originalPrice = priceResult.originalSubtotal;
  const savings = priceResult.savings;
  const discountPercent = priceResult.discountPercent;

  const maxQuantity = Math.min(availableQuantity, product.quantity);
  const isUnavailable = availableQuantity === 0;
  const bookingAttributeAxes = (product.bookingAttributeAxes || [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const fallbackAttributeValues = bookingAttributeAxes.reduce<
    Record<string, string[]>
  >((acc, axis) => {
    const values = new Set<string>();
    for (const unit of product.units || []) {
      if ((unit.status || 'available') !== 'available') continue;
      const value = unit.attributes?.[axis.key];
      if (value && value.trim()) {
        values.add(value.trim());
      }
    }
    acc[axis.key] = [...values].sort((a, b) => a.localeCompare(b, 'en'));
    return acc;
  }, {});
  const bookingAttributeValues = bookingAttributeAxes.reduce<
    Record<string, string[]>
  >((acc, axis) => {
    const values = new Set<string>();
    for (const combination of availableCombinations) {
      if (combination.availableQuantity <= 0) continue;
      const value = combination.selectedAttributes?.[axis.key];
      if (value && value.trim()) {
        values.add(value.trim());
      }
    }
    for (const fallbackValue of fallbackAttributeValues[axis.key] || []) {
      values.add(fallbackValue);
    }
    acc[axis.key] = [...values].sort((a, b) => a.localeCompare(b, 'en'));
    return acc;
  }, {});
  const hasBookingAttributes = bookingAttributeAxes.length > 0;
  const fallbackCombinations: CombinationAvailability[] = (() => {
    if (!hasBookingAttributes) {
      return [];
    }

    const byCombination = new Map<
      string,
      { selectedAttributes: Record<string, string>; availableQuantity: number }
    >();

    for (const unit of product.units || []) {
      if ((unit.status || 'available') !== 'available') continue;

      const selectedAttributes = (unit.attributes || {}) as Record<
        string,
        string
      >;
      const combinationKey = buildCombinationKey(
        bookingAttributeAxes,
        selectedAttributes,
      );
      const current = byCombination.get(combinationKey);
      if (!current) {
        byCombination.set(combinationKey, {
          selectedAttributes,
          availableQuantity: 1,
        });
      } else {
        current.availableQuantity += 1;
        byCombination.set(combinationKey, current);
      }
    }

    return [...byCombination.entries()]
      .map(([combinationKey, value]) => ({
        combinationKey,
        selectedAttributes: value.selectedAttributes,
        availableQuantity: value.availableQuantity,
        totalQuantity: value.availableQuantity,
        reservedQuantity: 0,
        status: 'available' as const,
      }))
      .sort((a, b) => {
        const sortA = getDeterministicCombinationSortValue(
          bookingAttributeAxes,
          a.selectedAttributes,
        );
        const sortB = getDeterministicCombinationSortValue(
          bookingAttributeAxes,
          b.selectedAttributes,
        );
        return sortA.localeCompare(sortB, 'en');
      });
  })();
  const effectiveCombinations =
    availableCombinations.length > 0
      ? availableCombinations
      : fallbackCombinations;
  const selectionSignature = useMemo(
    () => buildSelectionSignature(selectedAttributes),
    [selectedAttributes],
  );
  const matchingCartLine = cartLines.find(
    (line) => line.selectionSignature === selectionSignature,
  );
  const isInCart = Boolean(matchingCartLine);
  const productCartQuantity = getProductQuantityInCart(product.id);
  const selectionCapacity = getSelectionCapacity(
    bookingAttributeAxes,
    effectiveCombinations,
    selectedAttributes,
  );
  const shouldSplitAcrossCombinations =
    hasBookingAttributes && selectionCapacity.allocationMode === 'split';
  const effectiveMaxQuantity = hasBookingAttributes
    ? Math.min(maxQuantity, selectionCapacity.capacity)
    : maxQuantity;
  const isSelectionUnavailable =
    hasBookingAttributes && effectiveMaxQuantity === 0;

  const images =
    product.images && product.images.length > 0 ? product.images : [];

  // Video handling
  const videoId = product.videoUrl
    ? extractYouTubeVideoId(product.videoUrl)
    : null;
  const hasVideo = !!videoId;

  // Total media items count (images + video)
  const totalMediaItems = images.length + (hasVideo ? 1 : 0);
  const isVideoSelected = hasVideo && selectedImageIndex === images.length;

  const handleQuantityChange = (delta: number) => {
    const cap = Math.max(1, effectiveMaxQuantity);
    const newQty = Math.max(1, Math.min(quantity + delta, cap));
    setQuantity(newQty);
  };

  useEffect(() => {
    if (!isOpen) return;

    if (matchingCartLine) {
      setQuantity(
        Math.min(matchingCartLine.quantity, Math.max(1, effectiveMaxQuantity)),
      );
      return;
    }

    if (effectiveMaxQuantity > 0 && quantity > effectiveMaxQuantity) {
      setQuantity(effectiveMaxQuantity);
    }
  }, [isOpen, matchingCartLine, effectiveMaxQuantity, quantity]);

  const handleAddToCart = () => {
    if (hasBookingAttributes && effectiveMaxQuantity <= 0) {
      return;
    }

    if (shouldSplitAcrossCombinations) {
      const allocations = allocateAcrossCombinations(
        bookingAttributeAxes,
        effectiveCombinations,
        selectedAttributes,
        quantity,
      );

      if (!allocations || allocations.length === 0) {
        return;
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
            maxQuantity: Math.max(
              1,
              allocation.combination.availableQuantity || 0,
            ),
            pricingMode: effectivePricingMode,
            pricingTiers: product.pricingTiers?.map((tier) => ({
              id: tier.id,
              minDuration: tier.minDuration,
              discountPercent:
                typeof tier.discountPercent === 'string'
                  ? parseFloat(tier.discountPercent)
                  : tier.discountPercent,
            })),
            productPricingMode: product.pricingMode,
            selectedAttributes: allocation.combination.selectedAttributes,
          },
          storeSlug,
        );
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
      });

      if (availableAccessories.length > 0) {
        onClose();
        setAccessoriesModalOpen(true);
      } else {
        toastManager.add({
          title: tProduct('addedToCart', { name: product.name }),
          type: 'success',
        });
        onClose();
      }
      return;
    }

    if (matchingCartLine) {
      updateItemQuantityByLineId(matchingCartLine.lineId, quantity);
      // Track update quantity event
      trackEvent({
        eventType: 'update_quantity',
        metadata: {
          productId: product.id,
          productName: product.name,
          quantity,
          price: product.price,
        },
      });
      toastManager.add({
        title: tProduct('addedToCart', { name: product.name }),
        type: 'success',
      });
      onClose();
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
            discountPercent:
              typeof tier.discountPercent === 'string'
                ? parseFloat(tier.discountPercent)
                : tier.discountPercent,
          })),
          productPricingMode: product.pricingMode,
          selectedAttributes,
        },
        storeSlug,
      );

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
      });

      // Show accessories modal if there are available accessories, otherwise show toast
      if (availableAccessories.length > 0) {
        onClose();
        setAccessoriesModalOpen(true);
      } else {
        toastManager.add({
          title: tProduct('addedToCart', { name: product.name }),
          type: 'success',
        });
        onClose();
      }
    }
  };

  // Duration label
  const durationLabel = (() => {
    if (effectivePricingMode === 'hour') return `${days * 24 + hours}h`;
    if (days === 0) return `${hours}h`;
    if (hours === 0) return `${days}j`;
    return `${days}j ${hours}h`;
  })();

  // Pricing unit labels
  const pricingUnitLabel =
    effectivePricingMode === 'hour'
      ? tProduct('pricingUnit.hour.singular')
      : effectivePricingMode === 'week'
        ? tProduct('pricingUnit.week.singular')
        : tProduct('pricingUnit.day.singular');

  const pricingUnitLabelPlural =
    effectivePricingMode === 'hour'
      ? tProduct('pricingUnit.hour.plural')
      : effectivePricingMode === 'week'
        ? tProduct('pricingUnit.week.plural')
        : tProduct('pricingUnit.day.plural');

  const handlePrevImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedImageIndex((prev) =>
      prev === 0 ? totalMediaItems - 1 : prev - 1,
    );
  };

  const handleNextImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedImageIndex((prev) =>
      prev === totalMediaItems - 1 ? 0 : prev + 1,
    );
  };

  // Sort tiers for display
  const sortedTiers = tiers.length > 0 ? sortTiersByDuration(tiers) : [];

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogPopup className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{product.name}</DialogTitle>
          </DialogHeader>

          {/* Scrollable container for image + content */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* ===== IMAGE SECTION (top) ===== */}
            <div className="bg-muted/30 relative w-full">
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
                        className="absolute inset-0 h-full w-full"
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
                        <ImageIcon className="text-muted-foreground/30 h-16 w-16" />
                      </div>
                    )}

                    {/* Navigation arrows */}
                    {totalMediaItems > 1 && (
                      <>
                        <button
                          onClick={handlePrevImage}
                          className="bg-background/90 hover:bg-background absolute top-1/2 left-3 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full shadow-md backdrop-blur-sm transition-colors"
                          aria-label="Image précédente"
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                          onClick={handleNextImage}
                          className="bg-background/90 hover:bg-background absolute top-1/2 right-3 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full shadow-md backdrop-blur-sm transition-colors"
                          aria-label="Image suivante"
                        >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                      </>
                    )}

                    {/* Media counter badge */}
                    {totalMediaItems > 1 && (
                      <div className="bg-background/90 absolute right-3 bottom-3 rounded-full px-3 py-1.5 text-sm font-medium shadow-md backdrop-blur-sm">
                        {selectedImageIndex + 1} / {totalMediaItems}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageIcon className="text-muted-foreground/30 h-16 w-16" />
                  </div>
                )}
              </div>

              {/* Thumbnails strip */}
              {totalMediaItems > 1 && (
                <div className="bg-background/50 flex justify-center gap-2 border-b p-3">
                  {/* Image thumbnails */}
                  {images.slice(0, hasVideo ? 5 : 6).map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImageIndex(idx)}
                      className={cn(
                        'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-all',
                        selectedImageIndex === idx
                          ? 'border-primary ring-primary/20 ring-2'
                          : 'border-transparent opacity-70 hover:opacity-100',
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
                    <div className="bg-muted text-muted-foreground flex h-14 w-14 items-center justify-center rounded-lg text-sm font-medium">
                      +{images.length - (hasVideo ? 5 : 6)}
                    </div>
                  )}

                  {/* Video thumbnail */}
                  {hasVideo && videoId && (
                    <button
                      onClick={() => setSelectedImageIndex(images.length)}
                      className={cn(
                        'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-all',
                        isVideoSelected
                          ? 'border-primary ring-primary/20 ring-2'
                          : 'border-transparent opacity-70 hover:opacity-100',
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
                        <Play className="h-5 w-5 fill-white text-white" />
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
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {product.category && (
                      <p className="text-muted-foreground mb-1 text-sm">
                        {product.category.name}
                      </p>
                    )}
                    <h2 className="text-xl leading-tight font-semibold md:text-2xl">
                      {product.name}
                    </h2>
                  </div>
                  <Badge
                    variant={isUnavailable ? 'error' : 'secondary'}
                    className="shrink-0 text-xs"
                  >
                    {availableQuantity}{' '}
                    {t('stock', { count: availableQuantity }).replace(
                      /^\d+\s*/,
                      '',
                    )}
                  </Badge>
                </div>

                {/* Base price per unit - prominent display */}
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-primary text-2xl font-bold md:text-3xl">
                    {formatCurrency(price, currency)}
                  </span>
                  <span className="text-muted-foreground text-base">
                    / {pricingUnitLabel}
                  </span>
                </div>
              </div>

              {/* Description */}
              {product.description && (
                <div className="mb-5 border-b pb-5">
                  <div
                    className="text-muted-foreground prose prose-sm dark:prose-invert max-w-none text-sm [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_li]:mb-1 [&_ol]:mb-2 [&_p]:mb-2 [&_ul]:mb-2 [&>*]:break-words"
                    style={{
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                    }}
                    dangerouslySetInnerHTML={{ __html: product.description }}
                  />
                </div>
              )}

              {/* Pricing tiers section */}
              {sortedTiers.length > 0 && (
                <div className="rounded-xl border bg-gradient-to-br from-green-50/50 to-emerald-50/30 p-4 dark:from-green-950/20 dark:to-emerald-950/10">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="rounded-lg bg-green-100 p-1.5 dark:bg-green-900/40">
                      <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <span className="text-sm font-semibold">
                      {tProduct('tieredPricing.ratesTitle')}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {/* Base price row */}
                    <div className="bg-background/60 flex items-center justify-between rounded-lg px-3 py-1.5 text-sm">
                      <span className="text-muted-foreground">
                        1 {pricingUnitLabel}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(price, currency)}
                      </span>
                    </div>

                    {/* Tier rows */}
                    {sortedTiers.map((tier) => {
                      const effectivePrice = calculateEffectivePrice(
                        price,
                        tier,
                      );
                      const isCurrentTier =
                        duration >= tier.minDuration &&
                        !sortedTiers.some(
                          (t) =>
                            t.minDuration > tier.minDuration &&
                            duration >= t.minDuration,
                        );

                      return (
                        <div
                          key={tier.id}
                          className={cn(
                            'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                            isCurrentTier
                              ? 'bg-green-100 ring-1 ring-green-300 dark:bg-green-900/40 dark:ring-green-700'
                              : 'bg-background/60',
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                'font-medium',
                                isCurrentTier &&
                                  'text-green-700 dark:text-green-300',
                              )}
                            >
                              {tier.minDuration}+ {pricingUnitLabelPlural}
                            </span>
                            <Badge
                              className={cn(
                                'text-xs font-semibold',
                                isCurrentTier
                                  ? 'bg-green-600 text-white hover:bg-green-600'
                                  : 'bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300',
                              )}
                            >
                              -{Math.floor(tier.discountPercent)}%
                            </Badge>
                          </div>
                          <span
                            className={cn(
                              'font-semibold',
                              isCurrentTier &&
                                'text-green-700 dark:text-green-300',
                            )}
                          >
                            {formatCurrency(effectivePrice, currency)}/
                            {pricingUnitLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Booking attributes */}
              {bookingAttributeAxes.length > 0 && (
                <div className="mt-5 rounded-xl border p-4">
                  <p className="mb-3 text-sm font-medium">
                    {tProduct('bookingAttributes')}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {bookingAttributeAxes.map((axis) => (
                      <Select
                        key={axis.key}
                        value={selectedAttributes[axis.key] || '__none__'}
                        onValueChange={(value) => {
                          setSelectedAttributes((prev) => {
                            if (!value || value === '__none__') {
                              const next = { ...prev };
                              delete next[axis.key];
                              return next;
                            }

                            return { ...prev, [axis.key]: value };
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={axis.label}>
                            {selectedAttributes[axis.key] || axis.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value="__none__"
                            label={tProduct('bookingAttributeNone')}
                          >
                            {tProduct('bookingAttributeNone')}
                          </SelectItem>
                          {(bookingAttributeValues[axis.key] || []).length >
                          0 ? (
                            (bookingAttributeValues[axis.key] || []).map(
                              (value) => (
                                <SelectItem
                                  key={value}
                                  value={value}
                                  label={value}
                                >
                                  {value}
                                </SelectItem>
                              ),
                            )
                          ) : (
                            <SelectItem
                              value={`__empty_${axis.key}`}
                              label={axis.label}
                              disabled
                            >
                              {tProduct('bookingAttributesNoOptions', {
                                attribute: axis.label,
                              })}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    ))}
                  </div>
                  <p className="text-muted-foreground mt-2 text-xs">
                    {tProduct('bookingAttributesHelp')}
                  </p>
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium">
                      {tProduct('availableForSelection', {
                        count: effectiveMaxQuantity,
                      })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {selectionCapacity.allocationMode === 'single'
                        ? tProduct('quantityPerCombinationHint')
                        : tProduct('quantityCanSplitHint')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ===== FOOTER - Always visible at bottom ===== */}
          <div className="bg-background shrink-0 border-t p-4 md:p-5">
            {/* Price summary row */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-muted-foreground text-xs tracking-wide uppercase">
                  {tProduct('total')} ({durationLabel})
                </span>
                <div className="mt-0.5 flex items-baseline gap-2">
                  {savings > 0 && (
                    <span className="text-muted-foreground text-sm line-through">
                      {formatCurrency(originalPrice, currency)}
                    </span>
                  )}
                  <span className="text-primary text-2xl font-bold">
                    {formatCurrency(totalPrice, currency)}
                  </span>
                </div>
              </div>

              {savings > 0 && discountPercent && (
                <Badge className="bg-green-100 px-3 py-1 text-sm font-semibold text-green-700 dark:bg-green-900/50 dark:text-green-300">
                  -{Math.floor(discountPercent)}%
                </Badge>
              )}
            </div>

            {/* Quantity and CTA row */}
            <div className="flex items-center gap-3">
              {/* Quantity selector */}
              <div className="bg-muted flex shrink-0 items-center rounded-xl p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-background h-10 w-10 rounded-lg"
                  onClick={() => handleQuantityChange(-1)}
                  disabled={quantity <= 1 || isUnavailable}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center text-lg font-semibold tabular-nums">
                  {quantity}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-background h-10 w-10 rounded-lg"
                  onClick={() => handleQuantityChange(1)}
                  disabled={
                    quantity >= effectiveMaxQuantity ||
                    isUnavailable ||
                    isSelectionUnavailable
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Add to cart button */}
              <Button
                onClick={handleAddToCart}
                disabled={isUnavailable || isSelectionUnavailable}
                size="lg"
                className="h-12 flex-1 rounded-xl text-base font-semibold"
              >
                <ShoppingCart className="mr-2 h-5 w-5" />
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
            discountPercent:
              typeof tier.discountPercent === 'string'
                ? tier.discountPercent
                : tier.discountPercent.toString(),
          })),
        }))}
        storeSlug={storeSlug}
        currency={currency}
      />
    </>
  );
}
