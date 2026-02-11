'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useRouter, useSearchParams } from 'next/navigation';

import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock,
  Filter,
  Globe,
  Search,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Badge } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@louez/ui';
import { Skeleton } from '@louez/ui';
import { Alert, AlertDescription, AlertTitle } from '@louez/ui';

import { CartSidebar } from '@/components/storefront/cart-sidebar';
import { DatePickerModal } from '@/components/storefront/date-picker-modal';
import { PageTracker } from '@/components/storefront/page-tracker';
import { ProductCardAvailable } from '@/components/storefront/product-card-available';

import {
  type PricingMode,
  calculateDuration,
  formatDateTime,
  getDetailedDuration,
} from '@/lib/utils/duration';

import { useStorefrontUrl } from '@/hooks/use-storefront-url';

import { useCart } from '@/contexts/cart-context';

import type {
  BusinessHours,
  BusinessHoursValidation,
  CombinationAvailability,
  ProductAvailability,
} from '@louez/types';
import { orpc } from '@/lib/orpc/react';

interface PricingTier {
  id: string;
  minDuration: number;
  discountPercent: string | number;
  displayOrder: number | null;
}

interface Accessory {
  id: string;
  name: string;
  price: string;
  deposit: string;
  images: string[] | null;
  quantity: number;
  pricingMode: 'day' | 'hour' | 'week' | null;
  pricingTiers?: PricingTier[];
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  images: string[] | null;
  price: string;
  deposit: string | null;
  quantity: number;
  category: { id: string; name: string } | null;
  pricingMode?: PricingMode | null;
  pricingTiers?: PricingTier[];
  videoUrl?: string | null;
  accessories?: Accessory[];
  trackUnits?: boolean | null;
  bookingAttributeAxes?: Array<{ key: string; label: string; position: number }> | null;
  units?: Array<{
    status: 'available' | 'maintenance' | 'retired' | null;
    attributes: Record<string, string> | null;
  }>;
}

interface Category {
  id: string;
  name: string;
}

interface Store {
  id: string;
  slug: string;
  name: string;
  theme?: { primaryColor?: string } | null;
  settings?: {
    businessHours?: BusinessHours;
    advanceNotice?: number;
    timezone?: string;
  } | null;
}

interface RentalContentProps {
  store: Store;
  products: Product[];
  categories: Category[];
  pricingMode: PricingMode;
  startDate: string;
  endDate: string;
  categoryId?: string;
  searchTerm?: string;
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
  const t = useTranslations('storefront.availability');
  const tFilters = useTranslations('storefront.availability.filters');
  const tDate = useTranslations('storefront.dateSelection');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setGlobalDates, setPricingMode } = useCart();
  const { getUrl } = useStorefrontUrl(store.slug);

  const [searchTerm, setSearchTerm] = useState(initialSearchTerm || '');
  const [selectedCategory, setSelectedCategory] = useState(categoryId || 'all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isDateModalOpen, setIsDateModalOpen] = useState(false);

  const { data: availabilityData, isLoading } = useQuery(
    orpc.storefront.availability.get.queryOptions({
      input: {
        startDate,
        endDate,
      },
    }),
  );

  const availability = useMemo(() => {
    const map = new Map<string, ProductAvailability>();
    availabilityData?.products.forEach((item) => map.set(item.productId, item));
    return map;
  }, [availabilityData]);

  const businessHoursValidation: BusinessHoursValidation | null =
    availabilityData?.businessHoursValidation || null;

  const duration = useMemo(
    () => calculateDuration(startDate, endDate, pricingMode),
    [startDate, endDate, pricingMode],
  );

  // Detailed duration (days + hours)
  const detailedDuration = useMemo(
    () => getDetailedDuration(startDate, endDate),
    [startDate, endDate],
  );

  // Format start and end datetime in store timezone
  const storeTimezone = store.settings?.timezone;
  const startDateTime = useMemo(
    () => formatDateTime(startDate, { timezone: storeTimezone }),
    [startDate, storeTimezone],
  );
  const endDateTime = useMemo(
    () => formatDateTime(endDate, { timezone: storeTimezone }),
    [endDate, storeTimezone],
  );

  // Detect if user's browser timezone differs from the store's timezone
  const timezoneCity = useMemo(() => {
    if (!storeTimezone) return null;
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTimezone === storeTimezone) return null;
    // Extract city name from IANA timezone (e.g., "Europe/Paris" → "Paris")
    const city = storeTimezone.split('/').pop()?.replace(/_/g, ' ');
    return city || storeTimezone;
  }, [storeTimezone]);

  // Set global dates in cart context
  useEffect(() => {
    setGlobalDates(startDate, endDate);
    setPricingMode(pricingMode);
  }, [startDate, endDate, pricingMode, setGlobalDates, setPricingMode]);

  // Filter products
  const filteredProducts = useMemo(() => {
    let filtered = products;

    // Category filter
    if (selectedCategory && selectedCategory !== 'all') {
      filtered = filtered.filter((p) => p.category?.id === selectedCategory);
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.description?.toLowerCase().includes(term),
      );
    }

    return filtered;
  }, [products, selectedCategory, searchTerm]);

  // Sort products by availability
  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const aAvail = availability.get(a.id);
      const bAvail = availability.get(b.id);

      // Sort by status: available > limited > unavailable
      const statusOrder = { available: 0, limited: 1, unavailable: 2 };
      const aStatus = aAvail?.status || 'available';
      const bStatus = bAvail?.status || 'available';

      return statusOrder[aStatus] - statusOrder[bStatus];
    });
  }, [filteredProducts, availability]);

  const handleChangeDates = () => {
    setIsDateModalOpen(true);
  };

  const handleCategoryChange = (value: string | null) => {
    if (value === null) return;
    setSelectedCategory(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete('category');
    } else {
      params.set('category', value);
    }
    router.push(`${getUrl('/rental')}?${params.toString()}`, { scroll: false });
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedCategory('all');
    const params = new URLSearchParams();
    params.set('startDate', startDate);
    params.set('endDate', endDate);
    router.push(`${getUrl('/rental')}?${params.toString()}`, { scroll: false });
  };

  const hasFilters =
    searchTerm || (selectedCategory && selectedCategory !== 'all');

  const primaryColor = store.theme?.primaryColor || '#0066FF';

  // Format duration label with days + hours
  const durationLabel = (() => {
    const { days, hours } = detailedDuration;

    if (pricingMode === 'hour') {
      return `${detailedDuration.totalHours}h`;
    }

    if (days === 0) {
      return `${hours}h`;
    }

    const dayLabel = days === 1 ? tDate('durationDay') : tDate('durationDays');

    if (hours === 0) {
      return `${days} ${dayLabel}`;
    }

    return `${days} ${dayLabel} ${tDate('and')} ${hours}h`;
  })();

  return (
    <div className="container mx-auto px-4 py-4 md:py-6">
      <PageTracker
        page="rental"
        categoryId={selectedCategory !== 'all' ? selectedCategory : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
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
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                {/* Start */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${primaryColor}20` }}
                  >
                    <CalendarDays
                      className="h-4 w-4"
                      style={{ color: primaryColor }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                      {tDate('startLabel')}
                    </p>
                    <p className="text-sm font-medium">
                      {startDateTime.date}
                      <span className="text-muted-foreground ml-1 font-normal">
                        {startDateTime.time}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Arrow */}
                <ArrowRight className="text-muted-foreground hidden h-4 w-4 shrink-0 sm:block" />

                {/* End */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${primaryColor}20` }}
                  >
                    <Clock
                      className="h-4 w-4"
                      style={{ color: primaryColor }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                      {tDate('endLabel')}
                    </p>
                    <p className="text-sm font-medium">
                      {endDateTime.date}
                      <span className="text-muted-foreground ml-1 font-normal">
                        {endDateTime.time}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Duration badge */}
                <Badge
                  variant="secondary"
                  className="w-fit px-2.5 py-1 text-xs sm:text-sm"
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
                onClick={handleChangeDates}
                className="w-full shrink-0 sm:w-auto"
              >
                {t('changeDates')}
              </Button>
            </div>

            {/* Timezone notice */}
            {timezoneCity && (
              <div className="text-muted-foreground mt-3 flex items-center gap-1.5 border-t pt-3 text-xs">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span>{tDate('timezoneNotice', { city: timezoneCity })}</span>
              </div>
            )}
          </div>

          {/* Business Hours Warning */}
          {businessHoursValidation && !businessHoursValidation.valid && (
            <Alert
              variant="error"
              className="border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100"
            >
              <AlertTriangle className="h-4 w-4 !text-orange-600 dark:!text-orange-400" />
              <AlertTitle className="text-orange-900 dark:text-orange-100">
                {t('businessHoursWarning.title')}
              </AlertTitle>
              <AlertDescription className="text-orange-800 dark:text-orange-200">
                {businessHoursValidation.errors.map((error) => {
                  // Parse error like "pickup_outside_hours" or "return_day_closed"
                  const [action, ...reasonParts] = error.split('_');
                  const reason = reasonParts.join('_');
                  return (
                    <span key={error} className="block">
                      {t(`businessHoursWarning.${action}`)}:{' '}
                      {t(`businessHoursWarning.reasons.${reason}`)}
                    </span>
                  );
                })}
                <span className="mt-2 block text-sm">
                  {t('businessHoursWarning.suggestion')}
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* Filters */}
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <div className="flex items-center justify-between gap-4">
              <p className="text-muted-foreground text-sm">
                {t('productCountPlural', { count: sortedProducts.length })}
              </p>

              {/* Desktop filters */}
              <div className="hidden items-center gap-2 md:flex">
                <div className="relative w-48">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    placeholder={tFilters('search')}
                    value={searchTerm}
                    onChange={handleSearch}
                    className="h-9"
                  />
                </div>
                {categories.length > 0 && (
                  <Select
                    value={selectedCategory}
                    onValueChange={handleCategoryChange}
                  >
                    <SelectTrigger className="h-9 w-40">
                      <SelectValue placeholder={tFilters('categories')}>
                        {selectedCategory === 'all'
                          ? tFilters('allCategories')
                          : categories.find(cat => cat.id === selectedCategory)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label={tFilters('allCategories')}>
                        {tFilters('allCategories')}
                      </SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id} label={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {hasFilters && (
                  <Button
                    variant="ghost"
                    onClick={handleClearFilters}
                    className="h-9"
                  >
                    <X className="mr-1 h-4 w-4" />
                    {tFilters('clearFilters')}
                  </Button>
                )}
              </div>

              {/* Mobile filter toggle */}
              <CollapsibleTrigger
                className="md:hidden"
                render={<Button variant="outline" />}
              >
                <Filter className="mr-2 h-4 w-4" />
                Filtres
                <ChevronDown
                  className={`ml-2 h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
                />
              </CollapsibleTrigger>
            </div>

            {/* Mobile filters content */}
            <CollapsibleContent className="mt-4 md:hidden">
              <div className="bg-muted/30 flex flex-col gap-3 rounded-lg p-4">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                  <Input
                    placeholder={tFilters('search')}
                    value={searchTerm}
                    onChange={handleSearch}
                  />
                </div>
                {categories.length > 0 && (
                  <Select
                    value={selectedCategory}
                    onValueChange={handleCategoryChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tFilters('categories')}>
                        {selectedCategory === 'all'
                          ? tFilters('allCategories')
                          : categories.find(cat => cat.id === selectedCategory)?.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" label={tFilters('allCategories')}>
                        {tFilters('allCategories')}
                      </SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id} label={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {hasFilters && (
                  <Button
                    variant="ghost"
                    onClick={handleClearFilters}
                    className="justify-start"
                  >
                    <X className="mr-1 h-4 w-4" />
                    {tFilters('clearFilters')}
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Products Grid */}
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="aspect-square rounded-lg" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              ))}
            </div>
          ) : sortedProducts.length === 0 ? (
            <div className="py-16 text-center">
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
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
              {sortedProducts.map((product) => {
                const avail = availability.get(product.id);
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
                    availableCombinations={(avail?.combinations || []) as CombinationAvailability[]}
                  />
                );
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
        timezone={store.settings?.timezone}
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        initialStartDate={startDate}
        initialEndDate={endDate}
      />
    </div>
  );
}
