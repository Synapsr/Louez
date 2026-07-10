import { db } from '@louez/db'
import { getCurrentStore } from '@/lib/store-context'
import { categories, stores } from '@louez/db'
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

  // StoreWithFullData does not expose aiAdvisorSettings, so fetch just that column
  const storeAdvisorRow = await db.query.stores.findFirst({
    where: eq(stores.id, store.id),
    columns: { aiAdvisorSettings: true },
  })
  const showAiContext = storeAdvisorRow?.aiAdvisorSettings?.enabled === true

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('newProduct')}</h1>
        <p className="text-muted-foreground">
          {t('newProductDescription')}
        </p>
      </div>

      <ProductForm
        categories={categoriesList}
        storeTaxSettings={store.settings?.tax}
        showAiContext={showAiContext}
      />
    </div>
  )
}
