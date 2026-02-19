'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { addDays, format, setHours, setMinutes } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AlertCircle,
  ArrowRight,
  CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  ImageIcon,
  Play,
  TrendingDown,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { BusinessHours } from '@louez/types';
import { Button } from '@louez/ui';
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from '@louez/ui';
import { Popover, PopoverContent, PopoverTrigger } from '@louez/ui';
import { Calendar } from '@louez/ui';
import { ScrollArea } from '@louez/ui';
import { Badge } from '@louez/ui';
import { cn, formatCurrency, minutesToPriceDuration } from '@louez/utils';

import {
  generateTimeSlots,
  getAvailableTimeSlots,
  isDateAvailable,
} from '@/lib/utils/business-hours';
import {
  type PricingMode,
  getMinStartDate,
  isTimeSlotAvailable,
} from '@/lib/utils/duration';

import { useStorefrontUrl } from '@/hooks/use-storefront-url';
import {
  getStorefrontPricingSummary,
  getStorefrontRateRows,
} from '@/lib/utils/storefront-pricing';

import { useAnalytics } from '@/contexts/analytics-context';
import { useCart } from '@/contexts/cart-context';
import { useStoreCurrency } from '@/contexts/store-context';

interface PricingTier {
  id: string;
  minDuration: number | null;
  discountPercent: number | string | null;
  period?: number | null;
  price?: string | null;
  displayOrder: number | null;
}

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

interface ProductPreviewModalProps {
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
    basePeriodMinutes?: number | null;
    pricingTiers?: PricingTier[];
    videoUrl?: string | null;
  };
  isOpen: boolean;
  onClose: () => void;
  storeSlug: string;
  businessHours?: BusinessHours;
  advanceNotice?: number;
  timezone?: string;
}

const defaultTimeSlots = generateTimeSlots('07:00', '21:00', 30);

export function ProductPreviewModal({
  product,
  isOpen,
  onClose,
  storeSlug,
  businessHours,
  advanceNotice = 0,
  timezone,
}: ProductPreviewModalProps) {
  const tProduct = useTranslations('storefront.product');
  const tDateSelection = useTranslations('storefront.dateSelection');
  const tCommon = useTranslations('common');
  const currency = useStoreCurrency();
  const router = useRouter();
  const { setGlobalDates, setPricingMode } = useCart();
  const { getUrl } = useStorefrontUrl(storeSlug);
  const { trackEvent } = useAnalytics();

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Date picker state
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endTime, setEndTime] = useState<string>('18:00');

  const [startDateOpen, setStartDateOpen] = useState(false);
  const [startTimeOpen, setStartTimeOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);
  const [endTimeOpen, setEndTimeOpen] = useState(false);

  // Reset state when modal opens and track product view
  useEffect(() => {
    if (isOpen) {
      setSelectedImageIndex(0);
      setStartDate(undefined);
      setEndDate(undefined);
      setStartTime('09:00');
      setEndTime('18:00');
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
    }
  }, [
    isOpen,
    trackEvent,
    product.id,
    product.name,
    product.price,
    product.category?.name,
  ]);

  const price = parseFloat(product.price);
  const effectivePricingMode: PricingMode = product.pricingMode ?? 'day';

  useEffect(() => {
    setPricingMode(effectivePricingMode);
  }, [effectivePricingMode, setPricingMode]);

  const rateRows = useMemo(() => getStorefrontRateRows(product), [product]);
  const pricingSummary = useMemo(
    () => getStorefrontPricingSummary(product),
    [product],
  );
  const displayPeriodMinutes = pricingSummary.displayPeriodMinutes;
  const normalizedRateRows = useMemo(
    () =>
      rateRows.map((rate) => ({
        ...rate,
        displayUnitPrice:
          (rate.price / Math.max(1, rate.periodMinutes)) * displayPeriodMinutes,
      })),
    [displayPeriodMinutes, rateRows],
  );
  const baseRate = rateRows.find((rate) => rate.id === '__base__') ?? {
    id: '__base__',
    periodMinutes: 1440,
    price,
    reductionPercent: 0,
  };

  const images =
    product.images && product.images.length > 0 ? product.images : [];
  const videoId = product.videoUrl
    ? extractYouTubeVideoId(product.videoUrl)
    : null;
  const hasVideo = !!videoId;
  const totalMediaItems = images.length + (hasVideo ? 1 : 0);
  const isVideoSelected = hasVideo && selectedImageIndex === images.length;

  const formatPeriodLabel = useCallback(
    (
      periodMinutes: number,
      options?: {
        alwaysShowCount?: boolean;
      },
    ) => {
      const period = minutesToPriceDuration(periodMinutes);
      const alwaysShowCount = options?.alwaysShowCount ?? false;
      if (period.unit === 'minute') {
        const minuteLabel = tCommon('minuteUnit', { count: period.duration });
        if (period.duration === 1 && !alwaysShowCount) {
          return minuteLabel;
        }
        return `${period.duration} ${minuteLabel}`;
      }
      const unitLabel = tProduct(
        `pricingUnit.${period.unit}.${period.duration === 1 ? 'singular' : 'plural'}`,
      );
      if (period.duration === 1 && !alwaysShowCount) {
        return unitLabel;
      }
      return `${period.duration} ${unitLabel}`;
    },
    [tCommon, tProduct],
  );

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

  // Date picker logic
  const minDate = useMemo(
    () => getMinStartDate(advanceNotice),
    [advanceNotice],
  );

  const startTimeSlots = useMemo(() => {
    if (!startDate) return defaultTimeSlots;
    const businessHoursSlots = getAvailableTimeSlots(
      startDate,
      businessHours,
      30,
      timezone,
    );
    // Filter out time slots that are within the advance notice period
    return businessHoursSlots.filter((slot) =>
      isTimeSlotAvailable(startDate, slot, advanceNotice),
    );
  }, [startDate, businessHours, advanceNotice, timezone]);

  const endTimeSlots = useMemo(() => {
    if (!endDate) return defaultTimeSlots;
    return getAvailableTimeSlots(endDate, businessHours, 30, timezone);
  }, [endDate, businessHours, timezone]);

  const isDateDisabled = useCallback(
    (date: Date): boolean => {
      if (date < minDate) return true;
      if (!businessHours?.enabled) return false;
      const availability = isDateAvailable(date, businessHours, timezone);
      return !availability.available;
    },
    [businessHours, minDate, timezone],
  );

  useEffect(() => {
    if (
      startDate &&
      startTimeSlots.length > 0 &&
      !startTimeSlots.includes(startTime)
    ) {
      setStartTime(startTimeSlots[0]);
    }
  }, [startDate, startTimeSlots, startTime]);

  useEffect(() => {
    if (endDate && endTimeSlots.length > 0 && !endTimeSlots.includes(endTime)) {
      setEndTime(endTimeSlots[endTimeSlots.length - 1] || endTimeSlots[0]);
    }
  }, [endDate, endTimeSlots, endTime]);

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return;
    setStartDate(date);
    setStartDateOpen(false);

    if (!endDate || date >= endDate) {
      setEndDate(addDays(date, 1));
    }

    setTimeout(() => setStartTimeOpen(true), 200);
  };

  const handleStartTimeSelect = (time: string) => {
    setStartTime(time);
    setStartTimeOpen(false);
    setTimeout(() => setEndDateOpen(true), 200);
  };

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return;
    setEndDate(date);
    setEndDateOpen(false);
    setTimeout(() => setEndTimeOpen(true), 200);
  };

  const handleEndTimeSelect = (time: string) => {
    setEndTime(time);
    setEndTimeOpen(false);
  };

  const canSubmit = startDate && endDate && startTime && endTime;

  const handleSubmit = () => {
    if (!canSubmit) return;

    const [startH, startM] = startTime.split(':').map(Number);
    const finalStart = setMinutes(setHours(startDate!, startH), startM);
    const [endH, endM] = endTime.split(':').map(Number);
    const finalEnd = setMinutes(setHours(endDate!, endH), endM);

    setGlobalDates(finalStart.toISOString(), finalEnd.toISOString());
    const params = new URLSearchParams();
    params.set('startDate', finalStart.toISOString());
    params.set('endDate', finalEnd.toISOString());

    onClose();
    router.push(`${getUrl('/rental')}?${params.toString()}`);
  };

  const TimeSelector = ({
    value,
    onSelect,
    slots,
    disabledBefore,
  }: {
    value: string;
    onSelect: (time: string) => void;
    slots: string[];
    disabledBefore?: string;
  }) => (
    <ScrollArea className="h-56">
      <div className="p-1">
        {slots.length === 0 ? (
          <div className="text-muted-foreground p-4 text-center text-sm">
            <AlertCircle className="mx-auto mb-2 h-5 w-5" />
            {tDateSelection('businessHours.storeClosed')}
          </div>
        ) : (
          slots.map((time) => {
            const isDisabled = disabledBefore ? time <= disabledBefore : false;
            const isSelected = value === time;

            return (
              <button
                key={time}
                onClick={() => !isDisabled && onSelect(time)}
                disabled={isDisabled}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : isDisabled
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'hover:bg-muted',
                )}
              >
                <span className="font-medium">{time}</span>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })
        )}
      </div>
    </ScrollArea>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>

        {/* Scrollable container */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Image Section */}
          <div className="bg-muted/30 relative w-full">
            <div className="relative aspect-[4/3] w-full">
              {totalMediaItems > 0 ? (
                <>
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

            {/* Thumbnails */}
            {totalMediaItems > 1 && (
              <div className="bg-background/50 flex justify-center gap-2 border-b p-3">
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

                {images.length > (hasVideo ? 5 : 6) && (
                  <div className="bg-muted text-muted-foreground flex h-14 w-14 items-center justify-center rounded-lg text-sm font-medium">
                    +{images.length - (hasVideo ? 5 : 6)}
                  </div>
                )}

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
                    <Image
                      src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                      alt="Vidéo"
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Play className="h-5 w-5 fill-white text-white" />
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Content Section */}
          <div className="p-5 md:p-6">
            {/* Header */}
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
                {product.quantity === 0 && (
                  <Badge variant="error" className="shrink-0 text-xs">
                    {tProduct('unavailable')}
                  </Badge>
                )}
              </div>

              {/* Base price */}
              <div className="mt-3 flex items-baseline gap-2">
                {pricingSummary.showStartingFrom && (
                  <span className="text-muted-foreground text-sm font-medium">
                    {tProduct('startingFrom')}
                  </span>
                )}
                <span className="text-primary text-2xl font-bold md:text-3xl">
                  {formatCurrency(pricingSummary.displayPrice, currency)}
                </span>
                <span className="text-muted-foreground text-base">
                  / {formatPeriodLabel(displayPeriodMinutes)}
                </span>
                {pricingSummary.maxReductionPercent > 0 && (
                  <Badge variant="success" className="ml-2">
                    <TrendingDown className="mr-1 h-3 w-3" />
                    {tProduct('tieredPricing.badge', {
                      percent: Math.floor(pricingSummary.maxReductionPercent),
                    })}
                  </Badge>
                )}
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

            {/* Pricing tiers */}
            {rateRows.length > 1 && (
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
                  <div className="bg-background/60 flex items-center justify-between rounded-lg px-3 py-1.5 text-sm">
                    <span className="text-muted-foreground">
                      {formatPeriodLabel(baseRate.periodMinutes, {
                        alwaysShowCount: true,
                      })}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(
                        (baseRate.price / Math.max(1, baseRate.periodMinutes)) *
                          displayPeriodMinutes,
                        currency,
                      )}
                      / {formatPeriodLabel(displayPeriodMinutes)}
                    </span>
                  </div>

                  {normalizedRateRows
                    .filter((rate) => rate.id !== '__base__')
                    .map((rate) => {
                    return (
                      <div
                        key={rate.id}
                        className="bg-background/60 flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {formatPeriodLabel(rate.periodMinutes, {
                              alwaysShowCount: true,
                            })}
                          </span>
                          {rate.reductionPercent > 0 && (
                            <Badge className="bg-green-100 text-xs font-semibold text-green-700 dark:bg-green-900/60 dark:text-green-300">
                              -{Math.floor(rate.reductionPercent)}%
                            </Badge>
                          )}
                        </div>
                        <span className="font-semibold">
                          {formatCurrency(rate.displayUnitPrice, currency)}/
                          {formatPeriodLabel(displayPeriodMinutes)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer with Date Picker */}
        <div className="bg-muted/30 shrink-0 border-t p-4 md:p-5">
          <div className="flex flex-col gap-3">
            {/* Date/Time inputs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Start Date/Time */}
              <div>
                <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                  {tDateSelection('startLabel')}
                </label>
                <div className="bg-background flex h-11 overflow-hidden rounded-xl border">
                  <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                    <PopoverTrigger
                      render={
                        <button
                          className={cn(
                            'hover:bg-muted/50 flex min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors',
                            !startDate && 'text-muted-foreground',
                          )}
                        />
                      }
                    >
                      <CalendarIcon className="text-primary h-4 w-4 shrink-0" />
                      <span className="truncate text-sm font-medium">
                        {startDate
                          ? format(startDate, 'd MMM', { locale: fr })
                          : tDateSelection('startDate')}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={handleStartDateSelect}
                        disabled={isDateDisabled}
                        locale={fr}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>

                  <div className="bg-border my-2 w-px" />

                  <Popover open={startTimeOpen} onOpenChange={setStartTimeOpen}>
                    <PopoverTrigger
                      render={
                        <button className="hover:bg-muted/50 flex shrink-0 items-center gap-1.5 px-3 transition-colors" />
                      }
                    >
                      <Clock className="text-muted-foreground h-4 w-4" />
                      <span className="text-sm font-medium">{startTime}</span>
                    </PopoverTrigger>
                    <PopoverContent className="w-40 p-0" align="start">
                      <TimeSelector
                        value={startTime}
                        onSelect={handleStartTimeSelect}
                        slots={startTimeSlots}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* End Date/Time */}
              <div>
                <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                  {tDateSelection('endLabel')}
                </label>
                <div className="bg-background flex h-11 overflow-hidden rounded-xl border">
                  <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                    <PopoverTrigger
                      render={
                        <button
                          className={cn(
                            'hover:bg-muted/50 flex min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors',
                            !endDate && 'text-muted-foreground',
                          )}
                        />
                      }
                    >
                      <CalendarIcon className="text-primary h-4 w-4 shrink-0" />
                      <span className="truncate text-sm font-medium">
                        {endDate
                          ? format(endDate, 'd MMM', { locale: fr })
                          : tDateSelection('endDate')}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={handleEndDateSelect}
                        disabled={(date) =>
                          isDateDisabled(date) ||
                          (startDate ? date < startDate : false)
                        }
                        locale={fr}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>

                  <div className="bg-border my-2 w-px" />

                  <Popover open={endTimeOpen} onOpenChange={setEndTimeOpen}>
                    <PopoverTrigger
                      render={
                        <button className="hover:bg-muted/50 flex shrink-0 items-center gap-1.5 px-3 transition-colors" />
                      }
                    >
                      <Clock className="text-muted-foreground h-4 w-4" />
                      <span className="text-sm font-medium">{endTime}</span>
                    </PopoverTrigger>
                    <PopoverContent className="w-40 p-0" align="end">
                      <TimeSelector
                        value={endTime}
                        onSelect={handleEndTimeSelect}
                        slots={endTimeSlots}
                        disabledBefore={
                          startDate &&
                          endDate &&
                          startDate.toDateString() === endDate.toDateString()
                            ? startTime
                            : undefined
                        }
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            {/* CTA Button */}
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || product.quantity === 0}
              size="lg"
              className="h-12 w-full text-base font-semibold"
            >
              {tDateSelection('viewAvailability')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
