import { getDashboardProductsList } from '@louez/api/services'

import { getCurrentStore } from '@/lib/store-context'
import { getStoreLimits, getStorePlan } from '@/lib/plan-limits'
import { ProductsPageContent } from './products-page-content'
import { PRODUCT_STATUS_FILTERS, type ProductStatusFilter } from './types'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

function parseStatus(value: string | undefined): ProductStatusFilter {
  return PRODUCT_STATUS_FILTERS.includes(value as ProductStatusFilter)
    ? (value as ProductStatusFilter)
    : 'all'
}

/** nuqs serializes arrays as a comma-separated list; `all` is the legacy "no filter" value. */
function parseCategoryIds(value: string | undefined): string[] {
  if (!value || value === 'all') return []
  return value.split(',').filter(Boolean)
}

interface ProductsPageProps {
  searchParams: Promise<{ status?: string; category?: string; search?: string }>
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const store = await getCurrentStore()
  if (!store) return null

  const params = await searchParams
  const status = parseStatus(params.status)
  const categoryIds = parseCategoryIds(params.category)
  const search = params.search?.trim() ?? ''

  const [initialData, limits, plan] = await Promise.all([
    getDashboardProductsList({ storeId: store.id, status, categoryIds, search }),
    getStoreLimits(store.id),
    getStorePlan(store.id),
  ])

  return (
    <ProductsPageContent
      initialData={initialData}
      initialFilters={{ status, categoryIds, search }}
      limits={limits.products}
      planSlug={plan.slug}
      currency={store.settings?.currency}
    />
  )
}
