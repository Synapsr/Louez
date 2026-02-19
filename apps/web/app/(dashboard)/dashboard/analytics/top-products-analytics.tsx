'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Badge } from '@louez/ui'
import { Eye, ShoppingCart, Package } from 'lucide-react'

export interface TopProductData {
  productId: string
  productName: string
  views: number
  cartAdditions: number
  conversions: number
}

interface TopProductsAnalyticsProps {
  products: TopProductData[]
  storeSlug?: string
}

export function TopProductsAnalytics({ products, storeSlug }: TopProductsAnalyticsProps) {
  const t = useTranslations('dashboard.analytics')

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Package className="mb-2 h-8 w-8" />
        <p>{t('noProducts')}</p>
      </div>
    )
  }

  // Get max values for relative sizing
  const maxViews = Math.max(...products.map((p) => p.views), 1)

  return (
    <div className="space-y-3">
      {products.map((product, index) => {
        const viewsPercentage = (product.views / maxViews) * 100
        const conversionRate = product.views > 0
          ? ((product.conversions / product.views) * 100).toFixed(1)
          : '0'

        return (
          <div
            key={product.productId}
            className="relative overflow-hidden rounded-lg border bg-card p-4"
          >
            {/* Background bar */}
            <div
              className="absolute inset-y-0 left-0 bg-primary/5"
              style={{ width: `${viewsPercentage}%` }}
            />

            <div className="relative flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {/* Rank badge */}
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {index + 1}
                </div>

                {/* Product name */}
                <Link
                  href={`/dashboard/products/${product.productId}`}
                  className="truncate font-medium hover:underline"
                >
                  {product.productName}
                </Link>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4" />
                  <span className="tabular-nums">{product.views.toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <ShoppingCart className="h-4 w-4" />
                  <span className="tabular-nums">{product.cartAdditions.toLocaleString()}</span>
                </div>

                <Badge variant="secondary" className="tabular-nums">
                  {conversionRate}%
                </Badge>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
