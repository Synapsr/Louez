'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  CalendarDays,
  Search,
  X,
  Clock,
  ChevronDown,
  Filter,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@louez/ui'
import { Skeleton } from '@louez/ui'
import { Alert, AlertDescription, AlertTitle } from '@louez/ui'
import { ProductCardAvailable } from '@/components/storefront/product-card-available'
import { CartSidebar } from '@/components/storefront/cart-sidebar'
import { DatePickerModal } from '@/components/storefront/date-picker-modal'
import { PageTracker } from '@/components/storefront/page-tracker'
import { useCart } from '@/contexts/cart-context'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import {
  calculateDuration,
  getDetailedDuration,
  formatDateTime,
  type PricingMode,
} from '@/lib/utils/duration'
import type {
  ProductAvailability,
  AvailabilityResponse,
  BusinessHoursValidation,
} from '@/app/api/stores/[slug]/availability/route'

interface PricingTier {
  id: string
  minDuration: number
  discountPercent: string | number
  displayOrder: number | null
}

interface Accessory {
  id: string
  name: string
  price: string
  deposit: string
  images: string[] | null
  quantity: number
  pricingMode: 'day' | 'hour' | 'week' | null
  pricingTiers?: PricingTier[]
}

interface Product {
  id: string
  name: string
  description: string | null
  images: string[] | null
  price: string
  deposit: string | null
  quantity: number
  category: { id: string; name: string } | null
  pricingMode?: PricingMode | null
  pricingTiers?: PricingTier[]
  videoUrl?: string | null
  accessories?: Accessory[]
}

interface Category {
  id: string
  name: string
}

interface Store {
  id: string
  slug: string
  name: string
  theme?: { primaryColor?: string } | null
  settings?: {
    businessHours?: import('@/types/store').BusinessHours
    advanceNotice?: number
  } | null
}

interface RentalContentProps {
  store: Store
  products: Product[]
  categories: Category[]
  pricingMode: PricingMode
  startDate: string
  endDate: string
  categoryId?: string
  searchTerm?: string
}

export function RentalContent({
  store,
  products,
  categories,
  pricingMode,
  startDate,
  endDate,
  categoryId,
  searchTerm: initialSearchTerm,
}: RentalContentProps) {
  const t = useTranslations('storefront.availability')
  const tFilters = useTranslations('storefront.availability.filters')
  const tDate = useTranslations('storefront.dateSelection')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setGlobalDates, setPricingMode } = useCart()
  const { getUrl } = useStorefrontUrl(store.slug)

  const [availability, setAvailability] = useState<
    Map<string, ProductAvailability>
  >(new Map())
  const [businessHoursValidation, setBusinessHoursValidation] = useState<BusinessHoursValidation | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm || '')
  const [selectedCategory, setSelectedCategory] = useState(categoryId || 'all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [isDateModalOpen, setIsDateModalOpen] = useState(false)

  const duration = useMemo(
    () => calculateDuration(startDate, endDate, pricingMode),
    [startDate, endDate, pricingMode]
  )

  // Detailed duration (days + hours)
  const detailedDuration = useMemo(
    () => getDetailedDuration(startDate, endDate),
    [startDate, endDate]
  )

  // Format start and end datetime
  const startDateTime = useMemo(() => formatDateTime(startDate), [startDate])
  const endDateTime = useMemo(() => formatDateTime(endDate), [endDate])

  // Set global dates in cart context
  useEffect(() => {
    setGlobalDates(startDate, endDate)
    setPricingMode(pricingMode)
  }, [startDate, endDate, pricingMode, setGlobalDates, setPricingMode])

  // Fetch availability
  useEffect(() => {
    async function fetchAvailability() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          startDate,
          endDate,
        })
        const res = await fetch(
          `/api/stores/${store.slug}/availability?${params}`
        )
        if (res.ok) {
          const data: AvailabilityResponse = await res.json()
          const map = new Map<string, ProductAvailability>()
          data.products.forEach((p) => map.set(p.productId, p))
          setAvailability(map)
          // Store business hours validation result
          setBusinessHoursValidation(data.businessHoursValidation || null)
        }
      } catch (error) {
        console.error('Failed to fetch availability:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchAvailability()
  }, [store.slug, startDate, endDate])

  // Filter products
  const filteredProducts = useMemo(() => {
    let filtered = products

    // Category filter
    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.category?.id === selectedCategory)
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.description?.toLowerCase().includes(term)
      )
    }

    return filtered
  }, [products, selectedCategory, searchTerm])

  // Sort products by availability
  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const aAvail = availability.get(a.id)
      const bAvail = availability.get(b.id)

      // Sort by status: available > limited > unavailable
      const statusOrder = { available: 0, limited: 1, unavailable: 2 }
      const aStatus = aAvail?.status || 'available'
      const bStatus = bAvail?.status || 'available'

      return statusOrder[aStatus] - statusOrder[bStatus]
    })
  }, [filteredProducts, availability])

  const handleChangeDates = () => {
    setIsDateModalOpen(true)
  }

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value)
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete('category')
    } else {
      params.set('category', value)
    }
    router.push(`${getUrl('/rental')}?${params.toString()}`, { scroll: false })
  }

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
  }

  const handleClearFilters = () => {
    setSearchTerm('')
    setSelectedCategory('all')
    const params = new URLSearchParams()
    params.set('startDate', startDate)
    params.set('endDate', endDate)
    router.push(`${getUrl('/rental')}?${params.toString()}`, { scroll: false })
  }

  const hasFilters =
    searchTerm || (selectedCategory && selectedCategory !== 'all')

  const primaryColor = store.theme?.primaryColor || '#0066FF'

  // Format duration label with days + hours
  const durationLabel = (() => {
    const { days, hours } = detailedDuration

    if (pricingMode === 'hour') {
      return `${detailedDuration.totalHours}h`
    }

    if (days === 0) {
      return `${hours}h`
    }

    const dayLabel = days === 1 ? tDate('durationDay') : tDate('durationDays')

    if (hours === 0) {
      return `${days} ${dayLabel}`
    }

    return `${days} ${dayLabel} ${tDate('and')} ${hours}h`
  })()

  return (
    <div className="container mx-auto px-4 py-4 md:py-6">
      <PageTracker page="rental" categoryId={selectedCategory !== 'all' ? selectedCategory : undefined} />
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        {/* Main Content */}
        <div className="space-y-4">
          {/* Unified Date Header */}
          <div
            className="rounded-xl border-2 p-4"
            style={{
              borderColor: `${primaryColor}30`,
              backgroundColor: `${primaryColor}05`,
            }}
          >
            {/* Main date display */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                {/* Start */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: `${primaryColor}20` }}
                  >
                    <CalendarDays
                      className="h-4 w-4"
                      style={{ color: primaryColor }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {tDate('startLabel')}
                    </p>
                    <p className="font-medium text-sm">
                      {startDateTime.date}
                      <span className="text-muted-foreground font-normal ml-1">
                        {startDateTime.time}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Arrow */}
                <ArrowRight className="hidden sm:block h-4 w-4 text-muted-foreground shrink-0" />

                {/* End */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: `${primaryColor}20` }}
                  >
                    <Clock
                      className="h-4 w-4"
                      style={{ color: primaryColor }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {tDate('endLabel')}
                    </p>
                    <p className="font-medium text-sm">
                      {endDateTime.date}
                      <span className="text-muted-foreground font-normal ml-1">
                        {endDateTime.time}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Duration badge */}
                <Badge
                  variant="secondary"
                  className="text-xs sm:text-sm px-2.5 py-1 w-fit"
                  style={{
                    backgroundColor: `${primaryColor}15`,
                    color: primaryColor,
                  }}
                >
                  {durationLabel}
                </Badge>
              </div>

              {/* Change dates button */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleChangeDates}
                className="shrink-0 w-full sm:w-auto"
              >
                {t('changeDates')}
              </Button>
            </div>
          </div>

          {/* Business Hours Warning */}
          {businessHoursValidation && !businessHoursValidation.valid && (
            <Alert variant="destructive" className="border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100">
              <AlertTriangle className="h-4 w-4 !text-orange-600 dark:!text-orange-400" />
              <AlertTitle className="text-orange-900 dark:text-orange-100">
                {t('businessHoursWarning.title')}
              </AlertTitle>
              <AlertDescription className="text-orange-800 dark:text-orange-200">
                {businessHoursValidation.errors.map((error) => {
                  // Parse error like "pickup_outside_hours" or "return_day_closed"
                  const [action, ...reasonParts] = error.split('_')
                  const reason = reasonParts.join('_')
                  return (
                    <span key={error} className="block">
                      {t(`businessHoursWarning.${action}`)}: {t(`businessHoursWarning.reasons.${reason}`)}
                    </span>
                  )
                })}
                <span className="block mt-2 text-sm">
                  {t('businessHoursWarning.suggestion')}
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* Filters */}
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                {t('productCountPlural', { count: sortedProducts.length })}
              </p>

              {/* Desktop filters */}
              <div className="hidden md:flex items-center gap-2">
                <div className="relative w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={tFilters('search')}
                    value={searchTerm}
                    onChange={handleSearch}
                    className="pl-9 h-9"
                  />
                </div>
                {categories.length > 0 && (
                  <Select
                    value={selectedCategory}
                    onValueChange={handleCategoryChange}
                  >
                    <SelectTrigger className="w-40 h-9">
                      <SelectValue placeholder={tFilters('categories')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {tFilters('allCategories')}
                      </SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="h-9"
                  >
                    <X className="h-4 w-4 mr-1" />
                    {tFilters('clearFilters')}
                  </Button>
                )}
              </div>

              {/* Mobile filter toggle */}
              <CollapsibleTrigger asChild className="md:hidden">
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Filtres
                  <ChevronDown
                    className={`h-4 w-4 ml-2 transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>

            {/* Mobile filters content */}
            <CollapsibleContent className="md:hidden mt-4">
              <div className="flex flex-col gap-3 p-4 rounded-lg bg-muted/30">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={tFilters('search')}
                    value={searchTerm}
                    onChange={handleSearch}
                    className="pl-9"
                  />
                </div>
                {categories.length > 0 && (
                  <Select
                    value={selectedCategory}
                    onValueChange={handleCategoryChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tFilters('categories')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {tFilters('allCategories')}
                      </SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="justify-start"
                  >
                    <X className="h-4 w-4 mr-1" />
                    {tFilters('clearFilters')}
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Products Grid */}
          {isLoading ? (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="aspect-square rounded-lg" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              ))}
            </div>
          ) : sortedProducts.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-lg font-medium">{t('empty.title')}</p>
              <p className="text-muted-foreground mt-2">
                {t('empty.description')}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={handleChangeDates}
              >
                {t('empty.changeDates')}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
              {sortedProducts.map((product) => {
                const avail = availability.get(product.id)
                return (
                  <ProductCardAvailable
                    key={product.id}
                    product={product}
                    storeSlug={store.slug}
                    pricingMode={pricingMode}
                    availableQuantity={
                      avail?.availableQuantity ?? product.quantity
                    }
                    startDate={startDate}
                    endDate={endDate}
                    duration={duration}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Cart Sidebar */}
        <CartSidebar storeSlug={store.slug} showDates={false} />
      </div>

      {/* Date Picker Modal */}
      <DatePickerModal
        storeSlug={store.slug}
        pricingMode={pricingMode}
        businessHours={store.settings?.businessHours}
        advanceNotice={store.settings?.advanceNotice}
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        initialStartDate={startDate}
        initialEndDate={endDate}
      />
    </div>
  )
}
