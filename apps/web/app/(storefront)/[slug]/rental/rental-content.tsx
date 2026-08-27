"use client";

import { useEffect, useMemo, useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock,
  Globe,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  BusinessHours,
  BusinessHoursValidation,
  CombinationAvailability,
  PricingKind,
  ProductAvailability,
} from "@louez/types";
import { Button } from "@louez/ui";
import { Input } from "@louez/ui";
import { Badge } from "@louez/ui";
import { Skeleton } from "@louez/ui";
import { Alert, AlertDescription, AlertTitle } from "@louez/ui";

import { CartSidebar } from "@/components/storefront/cart-sidebar";
import {
  ALL_CATEGORIES_VALUE,
  UNCATEGORIZED_CATEGORY_VALUE,
  type CategoryBrowseEntry,
  CategoryBrowseGrid,
} from "@/components/storefront/category-browse-grid";
import { DatePickerModal } from "@/components/storefront/date-picker-modal";
import { PageTracker } from "@/components/storefront/page-tracker";
import { ProductCardAvailable } from "@/components/storefront/product-card-available";

import { orpc } from "@/lib/orpc/react";
import {
  type PricingMode,
  calculateDuration,
  formatDateTime,
  getDetailedDuration,
} from "@/lib/utils/duration";

import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { useBrowserTimezoneCity } from "@/hooks/use-browser-timezone-city";
import { useFormatLocale } from "@/hooks/use-format-locale";

import { useCart } from "@/contexts/cart-context";

interface PricingTier {
  id: string;
  minDuration: number | null;
  discountPercent: string | number | null;
  period?: number | null;
  price?: string | null;
  displayOrder: number | null;
}

interface Accessory {
  id: string;
  name: string;
  price: string;
  deposit: string;
  images: string[] | null;
  quantity: number;
  required?: boolean | null;
  requiredQuantity?: number | null;
  pricingKind?: PricingKind | null;
  pricingMode: "day" | "hour" | "week" | null;
  basePeriodMinutes?: number | null;
  pricingTiers?: PricingTier[];
}

interface SeasonalPricingData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  basePrice: number;
  tiers: {
    id: string;
    minDuration: number;
    discountPercent: number;
    displayOrder: number;
  }[];
  rates: { id: string; period: number; price: number; displayOrder: number }[];
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  images: string[] | null;
  price: string;
  deposit: string | null;
  quantity: number;
  displayQuantity?: number;
  category: { id: string; name: string; order?: number | null } | null;
  pricingKind?: PricingKind | null;
  pricingMode?: PricingMode | null;
  basePeriodMinutes?: number | null;
  enforceStrictTiers?: boolean;
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
    lifecycleStatus: "active" | "retired" | null;
    inDowntimeNow?: boolean;
    attributes: Record<string, string> | null;
  }>;
  seasonalPricings?: SeasonalPricingData[];
}

interface Category {
  id: string;
  name: string;
  order?: number | null;
  description?: string | null;
  imageUrl?: string | null;
}

interface Store {
  id: string;
  slug: string;
  name: string;
  theme?: { primaryColor?: string } | null;
  settings?: {
    businessHours?: BusinessHours;
    advanceNotice?: number;
    minRentalMinutes?: number;
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
  /** `categories` puts a category card grid in front of the product grid. */
  catalogBrowseMode?: "products" | "categories";
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
  catalogBrowseMode = "products",
}: RentalContentProps) {
  const t = useTranslations("storefront.availability");
  const tFilters = useTranslations("storefront.availability.filters");
  const tCatalog = useTranslations("storefront.catalog");
  const tBrowse = useTranslations("storefront.availability.categoryBrowse");
  const tDate = useTranslations("storefront.dateSelection");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setGlobalDates, setPricingMode } = useCart();
  const { getUrl } = useStorefrontUrl(store.slug);

  // Category-first browsing only makes sense with something to choose between.
  const isCategoriesMode = catalogBrowseMode === "categories" && categories.length >= 2;

  const [searchTerm, setSearchTerm] = useState(initialSearchTerm || "");
  // `null` means "nothing picked yet" — only reachable in categories mode, where
  // it is what makes the category cards show instead of the product grid.
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    categoryId || (isCategoriesMode ? null : ALL_CATEGORIES_VALUE),
  );
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

  const _duration = useMemo(
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
  const { intl: formatLocale } = useFormatLocale();
  const startDateTime = useMemo(
    () => formatDateTime(startDate, { timezone: storeTimezone, locale: formatLocale }),
    [formatLocale, startDate, storeTimezone],
  );
  const endDateTime = useMemo(
    () => formatDateTime(endDate, { timezone: storeTimezone, locale: formatLocale }),
    [endDate, formatLocale, storeTimezone],
  );

  const timezoneCity = useBrowserTimezoneCity(storeTimezone);

  // Set global dates in cart context
  useEffect(() => {
    setGlobalDates(startDate, endDate);
    setPricingMode(pricingMode);
  }, [startDate, endDate, pricingMode, setGlobalDates, setPricingMode]);

  // Filter products
  const filteredProducts = useMemo(() => {
    let filtered = products;

    // Category filter
    if (selectedCategory === UNCATEGORIZED_CATEGORY_VALUE) {
      filtered = filtered.filter((p) => !p.category?.id);
    } else if (selectedCategory && selectedCategory !== ALL_CATEGORIES_VALUE) {
      filtered = filtered.filter((p) => p.category?.id === selectedCategory);
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(term) || p.description?.toLowerCase().includes(term),
      );
    }

    return filtered;
  }, [products, selectedCategory, searchTerm]);

  // Keep the catalog category order first, then surface available products within each category.
  const sortedProducts = useMemo(() => {
    const categoryOrderById = new Map(
      categories.map((category, index) => [category.id, category.order ?? index]),
    );
    const originalOrderById = new Map(
      filteredProducts.map((product, index) => [product.id, index]),
    );
    const uncategorizedOrder = Number.MAX_SAFE_INTEGER;

    return [...filteredProducts].sort((a, b) => {
      const aCategoryOrder = a.category?.id
        ? (categoryOrderById.get(a.category.id) ?? a.category.order ?? uncategorizedOrder)
        : uncategorizedOrder;
      const bCategoryOrder = b.category?.id
        ? (categoryOrderById.get(b.category.id) ?? b.category.order ?? uncategorizedOrder)
        : uncategorizedOrder;

      if (aCategoryOrder !== bCategoryOrder) {
        return aCategoryOrder - bCategoryOrder;
      }

      const aAvail = availability.get(a.id);
      const bAvail = availability.get(b.id);

      const statusOrder = { available: 0, limited: 1, unavailable: 2 };
      const aStatus = aAvail?.status || "available";
      const bStatus = bAvail?.status || "available";
      const availabilityOrder = statusOrder[aStatus] - statusOrder[bStatus];

      if (availabilityOrder !== 0) {
        return availabilityOrder;
      }

      return (originalOrderById.get(a.id) ?? 0) - (originalOrderById.get(b.id) ?? 0);
    });
  }, [filteredProducts, availability, categories]);

  // Category cards, derived entirely from data already on the page — the counts
  // reuse the availability map, so browsing costs no extra request.
  const browseEntries = useMemo<CategoryBrowseEntry[]>(() => {
    if (!isCategoriesMode) return [];

    const isBookable = (product: Product) => {
      const status = availability.get(product.id)?.status;
      return status === "available" || status === "limited";
    };

    const byCategoryId = new Map<string, Product[]>();
    const uncategorized: Product[] = [];
    for (const product of products) {
      const id = product.category?.id;
      if (!id) {
        uncategorized.push(product);
        continue;
      }
      const bucket = byCategoryId.get(id);
      if (bucket) bucket.push(product);
      else byCategoryId.set(id, [product]);
    }

    const entries: CategoryBrowseEntry[] = [];

    for (const category of categories) {
      const bucket = byCategoryId.get(category.id);
      // A card leading to an empty grid is a dead end — skip it.
      if (!bucket || bucket.length === 0) continue;
      entries.push({
        id: category.id,
        name: category.name,
        description: category.description,
        // Fall back to the first product visual, then to the placeholder tile.
        imageUrl: category.imageUrl || bucket.find((p) => p.images?.[0])?.images?.[0] || null,
        availableCount: bucket.filter(isBookable).length,
        totalCount: bucket.length,
        variant: "category",
      });
    }

    if (uncategorized.length > 0) {
      entries.push({
        id: UNCATEGORIZED_CATEGORY_VALUE,
        name: tBrowse("others"),
        description: tBrowse("othersDescription"),
        imageUrl: uncategorized.find((p) => p.images?.[0])?.images?.[0] || null,
        availableCount: uncategorized.filter(isBookable).length,
        totalCount: uncategorized.length,
        variant: "uncategorized",
      });
    }

    entries.push({
      id: ALL_CATEGORIES_VALUE,
      name: tCatalog("allProducts"),
      description: tBrowse("allProductsDescription"),
      imageUrl: null,
      availableCount: products.filter(isBookable).length,
      totalCount: products.length,
      variant: "all",
    });

    return entries;
  }, [isCategoriesMode, products, categories, availability, tBrowse, tCatalog]);

  const hasUncategorizedEntry = browseEntries.some((entry) => entry.variant === "uncategorized");
  const realCategoryEntryCount = browseEntries.filter(
    (entry) => entry.variant === "category",
  ).length;

  // Search implies the customer already knows what they want: skip the cards.
  const showCategoryBrowse =
    isCategoriesMode &&
    selectedCategory === null &&
    !searchTerm.trim() &&
    realCategoryEntryCount >= 2;

  // With no explicit selection the "All products" pill is the honest highlight.
  const activePill = selectedCategory ?? ALL_CATEGORIES_VALUE;

  const handleChangeDates = () => {
    setIsDateModalOpen(true);
  };

  const handleCategoryChange = (value: string | null) => {
    setSelectedCategory(value);
    const params = new URLSearchParams(searchParams.toString());
    // In categories mode "all" is an explicit choice, so it stays in the URL —
    // dropping it would send the customer back to the cards on reload.
    if (value === null || (value === ALL_CATEGORIES_VALUE && !isCategoriesMode)) {
      params.delete("category");
    } else {
      params.set("category", value);
    }
    router.push(`${getUrl("/rental")}?${params.toString()}`, { scroll: false });
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    setSelectedCategory(isCategoriesMode ? null : ALL_CATEGORIES_VALUE);
    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    router.push(`${getUrl("/rental")}?${params.toString()}`, { scroll: false });
  };

  // Going back to the cards also drops the search, otherwise they stay hidden.
  const handleBackToCategories = handleClearFilters;

  const hasFilters = searchTerm || (selectedCategory && selectedCategory !== ALL_CATEGORIES_VALUE);

  const primaryColor = store.theme?.primaryColor || "#0066FF";

  // Format duration label with days + hours
  const durationLabel = (() => {
    const { days, hours } = detailedDuration;

    if (pricingMode === "hour") {
      return `${detailedDuration.totalHours}h`;
    }

    if (days === 0) {
      return `${hours}h`;
    }

    const dayLabel = days === 1 ? tDate("durationDay") : tDate("durationDays");

    if (hours === 0) {
      return `${days} ${dayLabel}`;
    }

    return `${days} ${dayLabel} ${tDate("and")} ${hours}h`;
  })();

  return (
    <div className="container mx-auto px-4 py-4 md:py-6">
      <PageTracker
        page="rental"
        categoryId={
          selectedCategory &&
          selectedCategory !== ALL_CATEGORIES_VALUE &&
          selectedCategory !== UNCATEGORIZED_CATEGORY_VALUE
            ? selectedCategory
            : undefined
        }
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
                    <CalendarDays className="h-4 w-4" style={{ color: primaryColor }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                      {tDate("startLabel")}
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
                    <Clock className="h-4 w-4" style={{ color: primaryColor }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-[10px] tracking-wide uppercase">
                      {tDate("endLabel")}
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
                  variant="expired"
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
                {t("changeDates")}
              </Button>
            </div>

            {/* Timezone notice */}
            {timezoneCity && (
              <div className="text-muted-foreground mt-3 flex items-center gap-1.5 border-t pt-3 text-xs">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span>{tDate("timezoneNotice", { city: timezoneCity })}</span>
              </div>
            )}
          </div>

          {/* Business Hours Warning */}
          {businessHoursValidation && !businessHoursValidation.valid && (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t("businessHoursWarning.title")}</AlertTitle>
              <AlertDescription>
                {businessHoursValidation.errors.map((error) => {
                  // Parse error like "pickup_outside_hours" or "return_day_closed"
                  const [action, ...reasonParts] = error.split("_");
                  const reason = reasonParts.join("_");
                  return (
                    <span key={error} className="block">
                      {t(`businessHoursWarning.${action}`)}:{" "}
                      {t(`businessHoursWarning.reasons.${reason}`)}
                    </span>
                  );
                })}
                <span className="mt-2 block text-sm">{t("businessHoursWarning.suggestion")}</span>
              </AlertDescription>
            </Alert>
          )}

          {/* Category pills — replaced by the category cards until one is picked */}
          {categories.length > 0 && !showCategoryBrowse && (
            <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
              {isCategoriesMode && realCategoryEntryCount >= 2 && (
                <button
                  type="button"
                  onClick={handleBackToCategories}
                  className="bg-background hover:bg-muted text-foreground flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {tBrowse("backToCategories")}
                </button>
              )}
              <button
                type="button"
                onClick={() => handleCategoryChange(ALL_CATEGORIES_VALUE)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activePill === ALL_CATEGORIES_VALUE
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted text-foreground border"
                }`}
              >
                {tCatalog("allProducts")}
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategoryChange(cat.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    activePill === cat.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted text-foreground border"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
              {hasUncategorizedEntry && (
                <button
                  type="button"
                  onClick={() => handleCategoryChange(UNCATEGORIZED_CATEGORY_VALUE)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    activePill === UNCATEGORIZED_CATEGORY_VALUE
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted text-foreground border"
                  }`}
                >
                  {tBrowse("others")}
                </button>
              )}
            </div>
          )}

          {/* Product count + search */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">
              {t("productCountPlural", { count: sortedProducts.length })}
            </p>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-48">
                <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  placeholder={tFilters("search")}
                  value={searchTerm}
                  onChange={handleSearch}
                  className="h-9"
                />
              </div>
              {hasFilters && (
                <Button variant="ghost" onClick={handleClearFilters} className="h-9 shrink-0">
                  <X className="mr-1 h-4 w-4" />
                  {tFilters("clearFilters")}
                </Button>
              )}
            </div>
          </div>

          {/* Category cards — the entry point in "categories" browse mode */}
          {showCategoryBrowse ? (
            <CategoryBrowseGrid
              entries={browseEntries}
              isAvailabilityLoading={isLoading}
              onSelect={handleCategoryChange}
            />
          ) : /* Products Grid */
          isLoading ? (
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="space-y-3">
                  <Skeleton className="aspect-[4/3] rounded-lg" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              ))}
            </div>
          ) : sortedProducts.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-lg font-medium">{t("empty.title")}</p>
              <p className="text-muted-foreground mt-2">{t("empty.description")}</p>
              <Button variant="outline" className="mt-4" onClick={handleChangeDates}>
                {t("empty.changeDates")}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
              {sortedProducts.map((product) => {
                const avail = availability.get(product.id);
                const availableCombinations = avail?.combinationsByKey
                  ? Object.values(avail.combinationsByKey)
                  : avail?.combinations || [];
                return (
                  <ProductCardAvailable
                    key={product.id}
                    product={product}
                    storeSlug={store.slug}
                    availableQuantity={
                      avail?.availableQuantity ?? product.displayQuantity ?? product.quantity
                    }
                    unavailableReason={avail?.reason}
                    startDate={startDate}
                    endDate={endDate}
                    availableCombinations={availableCombinations as CombinationAvailability[]}
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
        minRentalMinutes={store.settings?.minRentalMinutes}
        timezone={store.settings?.timezone}
        isOpen={isDateModalOpen}
        onClose={() => setIsDateModalOpen(false)}
        initialStartDate={startDate}
        initialEndDate={endDate}
      />
    </div>
  );
}
