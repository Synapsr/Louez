import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { categories, products } from '@/lib/db/schema'
import { eq, count } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { CategoriesList } from './categories-list'

async function getCategoriesWithCount(storeId: string) {
  const categoriesList = await db.query.categories.findMany({
    where: eq(categories.storeId, storeId),
    orderBy: [categories.order],
  })

  // Get product count for each category
  const categoriesWithCount = await Promise.all(
    categoriesList.map(async (category) => {
      const productCount = await db
        .select({ count: count() })
        .from(products)
        .where(eq(products.categoryId, category.id))

      return {
        ...category,
        productCount: productCount[0]?.count || 0,
      }
    })
  )

  return categoriesWithCount
}

export default async function CategoriesPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const categoriesList = await getCategoriesWithCount(store.id)
  const t = await getTranslations('categories')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">
          {t('description')}
        </p>
      </div>

      <CategoriesList categories={categoriesList} />
    </div>
  )
}
