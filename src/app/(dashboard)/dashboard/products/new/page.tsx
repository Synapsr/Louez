import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { categories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { ProductForm } from '../product-form'

export default async function NewProductPage() {
  const t = await getTranslations('dashboard.products')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const categoriesList = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('newProduct')}</h1>
        <p className="text-muted-foreground">
          {t('newProductDescription')}
        </p>
      </div>

      <ProductForm categories={categoriesList} pricingMode={store.settings?.pricingMode || 'day'} />
    </div>
  )
}
