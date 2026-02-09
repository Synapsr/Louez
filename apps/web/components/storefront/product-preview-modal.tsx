'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import {
  ImageIcon,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  Play,
  CalendarIcon,
  Clock,
  ArrowRight,
  Check,
  AlertCircle,
} from 'lucide-react'
import { format, addDays, setHours, setMinutes } from 'date-fns'
import { fr } from 'date-fns/locale'

import { Button } from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui'
import { Calendar } from '@louez/ui'
import { ScrollArea } from '@louez/ui'
import { Badge } from '@louez/ui'
import { cn, formatCurrency } from '@louez/utils'
import { useStoreCurrency } from '@/contexts/store-context'
import { useCart } from '@/contexts/cart-context'
import { useAnalytics } from '@/contexts/analytics-context'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { calculateEffectivePrice, sortTiersByDuration } from '@/lib/pricing'
import { getMinStartDate, isTimeSlotAvailable, type PricingMode } from '@/lib/utils/duration'
import type { BusinessHours } from '@louez/types'
import {
  isDateAvailable,
  getAvailableTimeSlots,
  generateTimeSlots,
} from '@/lib/utils/business-hours'

interface PricingTier {
  id: string
  minDuration: number
  discountPercent: number | string
  displayOrder: number | null
}

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

interface ProductPreviewModalProps {
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
  }
  isOpen: boolean
  onClose: () => void
  storeSlug: string
  storePricingMode: PricingMode
  businessHours?: BusinessHours
  advanceNotice?: number
  timezone?: string
}

const defaultTimeSlots = generateTimeSlots('07:00', '21:00', 30)

export function ProductPreviewModal({
  product,
  isOpen,
  onClose,
  storeSlug,
  storePricingMode,
  businessHours,
  advanceNotice = 0,
  timezone,
}: ProductPreviewModalProps) {
  const tProduct = useTranslations('storefront.product')
  const tDateSelection = useTranslations('storefront.dateSelection')
  const currency = useStoreCurrency()
  const router = useRouter()
  const { setGlobalDates, setPricingMode } = useCart()
  const { getUrl } = useStorefrontUrl(storeSlug)
  const { trackEvent } = useAnalytics()

  const [selectedImageIndex, setSelectedImageIndex] = useState(0)

  // Date picker state
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [startTime, setStartTime] = useState<string>('09:00')
  const [endTime, setEndTime] = useState<string>('18:00')

  const [startDateOpen, setStartDateOpen] = useState(false)
  const [startTimeOpen, setStartTimeOpen] = useState(false)
  const [endDateOpen, setEndDateOpen] = useState(false)
  const [endTimeOpen, setEndTimeOpen] = useState(false)

  // Reset state when modal opens and track product view
  useEffect(() => {
    if (isOpen) {
      setSelectedImageIndex(0)
      setStartDate(undefined)
      setEndDate(undefined)
      setStartTime('09:00')
      setEndTime('18:00')
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
    }
  }, [isOpen, trackEvent, product.id, product.name, product.price, product.category?.name])

  useEffect(() => {
    setPricingMode(storePricingMode)
  }, [storePricingMode, setPricingMode])

  const price = parseFloat(product.price)
  const effectivePricingMode = product.pricingMode || storePricingMode

  // Normalize tiers
  const tiers = product.pricingTiers?.map((tier, index) => ({
    id: tier.id,
    minDuration: tier.minDuration,
    discountPercent:
      typeof tier.discountPercent === 'string'
        ? parseFloat(tier.discountPercent)
        : tier.discountPercent,
    displayOrder: tier.displayOrder ?? index,
  })) || []

  const sortedTiers = tiers.length > 0 ? sortTiersByDuration(tiers) : []

  // Calculate max discount
  const maxDiscount = tiers.length > 0
    ? Math.max(...tiers.map((t) => t.discountPercent))
    : 0

  const images = product.images && product.images.length > 0 ? product.images : []
  const videoId = product.videoUrl ? extractYouTubeVideoId(product.videoUrl) : null
  const hasVideo = !!videoId
  const totalMediaItems = images.length + (hasVideo ? 1 : 0)
  const isVideoSelected = hasVideo && selectedImageIndex === images.length

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

  // Date picker logic
  const minDate = useMemo(() => getMinStartDate(advanceNotice), [advanceNotice])

  const startTimeSlots = useMemo(() => {
    if (!startDate) return defaultTimeSlots
    const businessHoursSlots = getAvailableTimeSlots(startDate, businessHours, 30, timezone)
    // Filter out time slots that are within the advance notice period
    return businessHoursSlots.filter(slot => isTimeSlotAvailable(startDate, slot, advanceNotice))
  }, [startDate, businessHours, advanceNotice, timezone])

  const endTimeSlots = useMemo(() => {
    if (!endDate) return defaultTimeSlots
    return getAvailableTimeSlots(endDate, businessHours, 30, timezone)
  }, [endDate, businessHours, timezone])

  const isDateDisabled = useCallback(
    (date: Date): boolean => {
      if (date < minDate) return true
      if (!businessHours?.enabled) return false
      const availability = isDateAvailable(date, businessHours, timezone)
      return !availability.available
    },
    [businessHours, minDate, timezone]
  )

  useEffect(() => {
    if (startDate && startTimeSlots.length > 0 && !startTimeSlots.includes(startTime)) {
      setStartTime(startTimeSlots[0])
    }
  }, [startDate, startTimeSlots, startTime])

  useEffect(() => {
    if (endDate && endTimeSlots.length > 0 && !endTimeSlots.includes(endTime)) {
      setEndTime(endTimeSlots[endTimeSlots.length - 1] || endTimeSlots[0])
    }
  }, [endDate, endTimeSlots, endTime])

  const handleStartDateSelect = (date: Date | undefined) => {
    if (!date) return
    setStartDate(date)
    setStartDateOpen(false)

    if (!endDate || date >= endDate) {
      setEndDate(addDays(date, 1))
    }

    setTimeout(() => setStartTimeOpen(true), 200)
  }

  const handleStartTimeSelect = (time: string) => {
    setStartTime(time)
    setStartTimeOpen(false)
    setTimeout(() => setEndDateOpen(true), 200)
  }

  const handleEndDateSelect = (date: Date | undefined) => {
    if (!date) return
    setEndDate(date)
    setEndDateOpen(false)
    setTimeout(() => setEndTimeOpen(true), 200)
  }

  const handleEndTimeSelect = (time: string) => {
    setEndTime(time)
    setEndTimeOpen(false)
  }

  const canSubmit = startDate && endDate && startTime && endTime

  const handleSubmit = () => {
    if (!canSubmit) return

    const [startH, startM] = startTime.split(':').map(Number)
    const finalStart = setMinutes(setHours(startDate!, startH), startM)
    const [endH, endM] = endTime.split(':').map(Number)
    const finalEnd = setMinutes(setHours(endDate!, endH), endM)

    setGlobalDates(finalStart.toISOString(), finalEnd.toISOString())
    const params = new URLSearchParams()
    params.set('startDate', finalStart.toISOString())
    params.set('endDate', finalEnd.toISOString())

    onClose()
    router.push(`${getUrl('/rental')}?${params.toString()}`)
  }

  const TimeSelector = ({
    value,
    onSelect,
    slots,
    disabledBefore,
  }: {
    value: string
    onSelect: (time: string) => void
    slots: string[]
    disabledBefore?: string
  }) => (
    <ScrollArea className="h-56">
      <div className="p-1">
        {slots.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            {tDateSelection('businessHours.storeClosed')}
          </div>
        ) : (
          slots.map((time) => {
            const isDisabled = disabledBefore ? time <= disabledBefore : false
            const isSelected = value === time

            return (
              <button
                key={time}
                onClick={() => !isDisabled && onSelect(time)}
                disabled={isDisabled}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors text-sm',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : isDisabled
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'hover:bg-muted'
                )}
              >
                <span className="font-medium">{time}</span>
                {isSelected && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })
        )}
      </div>
    </ScrollArea>
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent variant="storefront" className="max-w-2xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>

        {/* Scrollable container */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {/* Image Section */}
          <div className="relative w-full bg-muted/30">
            <div className="relative aspect-[4/3] w-full">
              {totalMediaItems > 0 ? (
                <>
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

            {/* Thumbnails */}
            {totalMediaItems > 1 && (
              <div className="flex justify-center gap-2 p-3 bg-background/50 border-b">
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

                {images.length > (hasVideo ? 5 : 6) && (
                  <div className="flex items-center justify-center h-14 w-14 rounded-lg bg-muted text-muted-foreground text-sm font-medium">
                    +{images.length - (hasVideo ? 5 : 6)}
                  </div>
                )}

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
                    <Image
                      src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                      alt="Vidéo"
                      fill
                      className="object-cover"
                      sizes="56px"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Play className="h-5 w-5 text-white fill-white" />
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
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  {product.category && (
                    <p className="text-sm text-muted-foreground mb-1">
                      {product.category.name}
                    </p>
                  )}
                  <h2 className="text-xl md:text-2xl font-semibold leading-tight">
                    {product.name}
                  </h2>
                </div>
                {product.quantity === 0 && (
                  <Badge variant="destructive" className="shrink-0 text-xs">
                    {tProduct('unavailable')}
                  </Badge>
                )}
              </div>

              {/* Base price */}
              <div className="flex items-baseline gap-2 mt-3">
                <span className="text-2xl md:text-3xl font-bold text-primary">
                  {formatCurrency(price, currency)}
                </span>
                <span className="text-muted-foreground text-base">
                  / {pricingUnitLabel}
                </span>
                {maxDiscount > 0 && (
                  <Badge className="ml-2 bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                    <TrendingDown className="h-3 w-3 mr-1" />
                    jusqu&apos;à -{maxDiscount}%
                  </Badge>
                )}
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

            {/* Pricing tiers */}
            {sortedTiers.length > 0 && (
              <div className="rounded-xl border bg-gradient-to-br from-green-50/50 to-emerald-50/30 dark:from-green-950/20 dark:to-emerald-950/10 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 rounded-lg bg-green-100 dark:bg-green-900/40">
                    <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                  </div>
                  <span className="font-semibold text-sm">
                    {tProduct('tieredPricing.ratesTitle')}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-background/60">
                    <span className="text-muted-foreground">1 {pricingUnitLabel}</span>
                    <span className="font-medium">{formatCurrency(price, currency)}</span>
                  </div>

                  {sortedTiers.map((tier) => {
                    const effectivePrice = calculateEffectivePrice(price, tier)

                    return (
                      <div
                        key={tier.id}
                        className="flex items-center justify-between text-sm py-2 px-3 rounded-lg bg-background/60"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {tier.minDuration}+ {pricingUnitLabelPlural}
                          </span>
                          <Badge className="text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-300">
                            -{tier.discountPercent}%
                          </Badge>
                        </div>
                        <span className="font-semibold">
                          {formatCurrency(effectivePrice, currency)}/{pricingUnitLabel}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer with Date Picker */}
        <div className="shrink-0 border-t bg-muted/30 p-4 md:p-5">
          <div className="flex flex-col gap-3">
            {/* Date/Time inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Start Date/Time */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {tDateSelection('startLabel')}
                </label>
                <div className="flex rounded-xl border bg-background overflow-hidden h-11">
                  <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
                    <PopoverTrigger render={<button
                        className={cn(
                          'flex-1 flex items-center gap-2 px-3 text-left hover:bg-muted/50 transition-colors min-w-0',
                          !startDate && 'text-muted-foreground'
                        )}
                      />}>
                        <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="font-medium text-sm truncate">
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

                  <div className="w-px bg-border my-2" />

                  <Popover open={startTimeOpen} onOpenChange={setStartTimeOpen}>
                    <PopoverTrigger render={<button className="flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors shrink-0" />}>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{startTime}</span>
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
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  {tDateSelection('endLabel')}
                </label>
                <div className="flex rounded-xl border bg-background overflow-hidden h-11">
                  <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
                    <PopoverTrigger render={<button
                        className={cn(
                          'flex-1 flex items-center gap-2 px-3 text-left hover:bg-muted/50 transition-colors min-w-0',
                          !endDate && 'text-muted-foreground'
                        )}
                      />}>
                        <CalendarIcon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="font-medium text-sm truncate">
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
                          isDateDisabled(date) || (startDate ? date < startDate : false)
                        }
                        locale={fr}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>

                  <div className="w-px bg-border my-2" />

                  <Popover open={endTimeOpen} onOpenChange={setEndTimeOpen}>
                    <PopoverTrigger render={<button className="flex items-center gap-1.5 px-3 hover:bg-muted/50 transition-colors shrink-0" />}>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{endTime}</span>
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
              className="w-full h-12 text-base font-semibold"
            >
              {tDateSelection('viewAvailability')}
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
