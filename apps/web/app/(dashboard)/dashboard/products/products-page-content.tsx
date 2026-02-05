'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Plus, FolderOpen, Lock, ArrowUpDown } from 'lucide-react'

import { Button } from '@louez/ui'
import { ProductsTable } from './products-table'
import { ProductsFilters } from './products-filters'
import { ProductsOrderDialog } from './products-order-dialog'
import {
  UpgradeModal,
  LimitBanner,
  BlurOverlay,
} from '@/components/dashboard/upgrade-modal'
import type { LimitStatus } from '@/lib/plan-limits'

interface Product {
  id: string
  name: string
  images: string[] | null
  price: string
  deposit: string | null
  quantity: number
  status: 'draft' | 'active' | 'archived' | null
  category: {
    id: string
    name: string
  } | null
}

interface Category {
  id: string
  name: string
  storeId: string
  order: number | null
}

interface ProductCounts {
  all: number
  active: number
  draft: number
  archived: number
}

interface ProductsPageContentProps {
  products: Product[]
  categories: Category[]
  counts: ProductCounts
  currentStatus?: string
  currentCategory?: string
  limits: LimitStatus
  planSlug: string
  currency?: string
}

export function ProductsPageContent({
  products,
  categories,
  counts,
  currentStatus,
  currentCategory,
  limits,
  planSlug,
  currency,
}: ProductsPageContentProps) {
  const t = useTranslations('dashboard.products')
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [showOrderDialog, setShowOrderDialog] = useState(false)

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

  const handleAddProductClick = (e: React.MouseEvent) => {
    if (isAtLimit) {
      e.preventDefault()
      setShowUpgradeModal(true)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/categories">
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('manageCategories')}
            </Link>
          </Button>
          {isAtLimit ? (
            <Button onClick={() => setShowUpgradeModal(true)}>
              <Lock className="mr-2 h-4 w-4" />
              {t('addProduct')}
            </Button>
          ) : (
            <Button asChild>
              <Link href="/dashboard/products/new" onClick={handleAddProductClick}>
                <Plus className="mr-2 h-4 w-4" />
                {t('addProduct')}
              </Link>
            </Button>
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
      <div className="flex items-center justify-between gap-4">
        <ProductsFilters
          categories={categories}
          counts={counts}
          currentStatus={currentStatus}
          currentCategory={currentCategory}
        />
        {products.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowOrderDialog(true)}
          >
            <ArrowUpDown className="mr-2 h-4 w-4" />
            {t('reorder')}
          </Button>
        )}
      </div>

      {/* Products Table - Visible */}
      <ProductsTable products={visibleProducts} currency={currency} />

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

      {/* Products Order Dialog */}
      <ProductsOrderDialog
        open={showOrderDialog}
        onOpenChange={setShowOrderDialog}
        products={products}
      />
    </div>
  )
}
