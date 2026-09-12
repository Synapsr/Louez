'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Plus, FolderOpen, Lock, ArrowUpDown, SearchX } from 'lucide-react'

import { Button } from '@louez/ui'
import { CategoryManagerDrawer } from '@/components/categories/category-manager-drawer'
import { NewFeatureBadge } from '@/components/dashboard/new-feature-badge'
import { useDebounce } from '@/hooks/use-debounce'
import { useWhatsNew } from '@/hooks/use-whats-new'
import { invalidateProductsList } from '@/lib/orpc/invalidation'
import { categoriesQueries } from '@/lib/queries/categories.queries'
import { productsQueries } from '@/lib/queries/products.queries'
import { ProductsTable } from './products-table'
import { ProductsFilters, useProductsFilters } from './products-filters'
import { ProductsOrderDialog } from './products-order-dialog'
import {
  UpgradeModal,
  LimitBanner,
  BlurOverlay,
} from '@/components/dashboard/upgrade-modal'
import type { LimitStatus } from '@/lib/plan-limits'
import type { ProductStatusFilter, ProductsList } from './types'

const EMPTY_COUNTS = { all: 0, active: 0, draft: 0, archived: 0 }

interface ProductsPageContentProps {
  initialData: ProductsList
  /** Filters the server rendered `initialData` with. */
  initialFilters: {
    status: ProductStatusFilter
    categoryIds: string[]
    search: string
  }
  limits: LimitStatus
  planSlug: string
  currency?: string
}

export function ProductsPageContent({
  initialData,
  initialFilters,
  limits,
  planSlug,
  currency,
}: ProductsPageContentProps) {
  const t = useTranslations('dashboard.products')
  const queryClient = useQueryClient()
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [showOrderDialog, setShowOrderDialog] = useState(false)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const { status, categoryIds, search, setCategoryIds, setSearch } = useProductsFilters()
  // Fetch once typing pauses, but drop the search right away when it is cleared
  const debouncedSearch = useDebounce(search.trim(), 300)
  const querySearch = search.trim() ? debouncedSearch : ''
  const { dismissFeature } = useWhatsNew()

  // Filter changes are shallow, so the server props keep describing the
  // filters of the first render — only seed the cache while they still match.
  const matchesInitialFilters =
    status === initialFilters.status &&
    categoryIds.join(',') === initialFilters.categoryIds.join(',') &&
    querySearch === initialFilters.search

  const productsQuery = useQuery({
    ...productsQueries.list({ status, categoryIds, search: querySearch }),
    initialData: matchesInitialFilters ? initialData : undefined,
    // Keep the previous list on screen while the new filter loads
    placeholderData: (previousData) => previousData,
  })
  const categoriesQuery = useQuery(categoriesQueries.list())

  const products = productsQuery.data?.products ?? []
  const counts = productsQuery.data?.counts ?? EMPTY_COUNTS

  // Determine which products to show vs blur
  const displayLimit = limits.limit
  const hasLimit = displayLimit !== null
  const isOverLimit = limits.isOverLimit
  const isAtLimit = limits.isAtLimit

  // Split products into visible and blurred
  const visibleProducts = hasLimit && isOverLimit
    ? products.slice(0, displayLimit)
    : products
  const blurredProducts = hasLimit && isOverLimit
    ? products.slice(displayLimit)
    : []

  /**
   * Deleting a category reassigns (or unlinks) its products, so the list and
   * the filter selection both have to let go of it.
   */
  const handleCategoryDeleted = (categoryId: string) => {
    if (categoryIds.includes(categoryId)) {
      setCategoryIds(categoryIds.filter((id) => id !== categoryId))
    }
    void invalidateProductsList(queryClient)
  }

  const handleAddProductClick = (e: React.MouseEvent) => {
    if (isAtLimit) {
      e.preventDefault()
      setShowUpgradeModal(true)
      return
    }

    // Opening the redesigned creation flow is the interaction the badge announces,
    // so only a click that actually reaches it may burn the badge.
    dismissFeature('product-creation-flow-redesign')
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm sm:text-base text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="sm:hidden"
            title={t('manageCategories')}
            onClick={() => setCategoryManagerOpen(true)}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="hidden sm:inline-flex"
            onClick={() => setCategoryManagerOpen(true)}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('manageCategories')}
          </Button>
          {isAtLimit ? (
            <>
              <Button
                size="icon"
                className="sm:hidden"
                onClick={() => setShowUpgradeModal(true)}
                title={t('addProduct')}
              >
                <Lock className="h-4 w-4" />
              </Button>
              <Button
                className="hidden sm:inline-flex"
                onClick={() => setShowUpgradeModal(true)}
              >
                <Lock className="mr-2 h-4 w-4" />
                {t('addProduct')}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon"
                className="sm:hidden"
                // The badge adds screen reader text, so the name has to be explicit.
                aria-label={t('addProduct')}
                title={t('addProduct')}
                render={<Link href="/dashboard/products/new" onClick={handleAddProductClick} />}
              >
                <Plus className="h-4 w-4" />
                {/* Inset inside the primary fill: the default dot colour is the
                    button's own background, so it needs the inverse token. */}
                <NewFeatureBadge
                  className="absolute top-1 right-1 bg-primary-foreground"
                  featureId="product-creation-flow-redesign"
                  mode="dot"
                />
              </Button>
              <Button
                className="hidden sm:inline-flex"
                render={<Link href="/dashboard/products/new" onClick={handleAddProductClick} />}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('addProduct')}
                <NewFeatureBadge
                  className="bg-primary-foreground text-primary"
                  featureId="product-creation-flow-redesign"
                />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Limit Banner */}
      {hasLimit && (
        <LimitBanner
          limitType="products"
          current={limits.current}
          limit={limits.limit!}
          currentPlan={planSlug}
          onUpgradeClick={() => setShowUpgradeModal(true)}
        />
      )}

      {/* Filters */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <ProductsFilters
            categories={categoriesQuery.data ?? []}
            counts={counts}
            isLoadingCategories={categoriesQuery.isPending}
          />
        </div>
        {products.length > 1 && (
          <>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 sm:hidden"
              onClick={() => setShowOrderDialog(true)}
              title={t('reorder')}
            >
              <ArrowUpDown className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="hidden shrink-0 sm:inline-flex"
              onClick={() => setShowOrderDialog(true)}
            >
              <ArrowUpDown className="mr-2 h-4 w-4" />
              {t('reorder')}
            </Button>
          </>
        )}
      </div>

      {/* Products Table - Visible */}
      <div
        className={
          productsQuery.isPlaceholderData || productsQuery.isFetching
            ? 'opacity-60 transition-opacity'
            : 'transition-opacity'
        }
      >
        {querySearch && products.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
            <SearchX className="h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">{t('noSearchResults')}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('noSearchResultsDescription', { search: querySearch })}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => setSearch('')}>
              {t('clearSearch')}
            </Button>
          </div>
        ) : (
          <ProductsTable products={visibleProducts} currency={currency} />
        )}
      </div>

      {/* Blurred Products Section */}
      {blurredProducts.length > 0 && (
        <div className="relative">
          {/* Blurred table */}
          <div className="blur-sm pointer-events-none select-none opacity-60">
            <ProductsTable products={blurredProducts} currency={currency} />
          </div>

          {/* Overlay */}
          <BlurOverlay
            limitType="products"
            currentPlan={planSlug}
            onUpgradeClick={() => setShowUpgradeModal(true)}
          />
        </div>
      )}

      {/* Upgrade Modal */}
      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        limitType="products"
        currentCount={limits.current}
        limit={limits.limit || 5}
        currentPlan={planSlug}
      />

      {/* Category management — drawer only, there is no categories page */}
      <CategoryManagerDrawer
        open={categoryManagerOpen}
        onOpenChange={setCategoryManagerOpen}
        onCategoryDeleted={handleCategoryDeleted}
      />

      {/* Products Order Dialog */}
      <ProductsOrderDialog
        open={showOrderDialog}
        onOpenChange={setShowOrderDialog}
        products={products}
      />
    </div>
  )
}
