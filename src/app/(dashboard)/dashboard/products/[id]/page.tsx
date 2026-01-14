import { db } from '@/lib/db'
import { getCurrentStore } from '@/lib/store-context'
import { products, categories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { redirect, notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { ProductForm } from '../product-form'

interface EditProductPageProps {
  params: Promise<{ id: string }>
}

export default async function EditProductPage({ params }: EditProductPageProps) {
  const t = await getTranslations('dashboard.products')
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const { id } = await params

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.storeId, store.id)),
    with: {
      category: true,
      pricingTiers: true,
    },
  })

  if (!product) {
    notFound()
  }

  const categoriesList = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('editProduct')}</h1>
        <p className="text-muted-foreground">
          {t('editProductDescription')}
        </p>
      </div>

      <ProductForm
        product={product}
        categories={categoriesList}
        pricingMode={store.settings?.pricingMode || 'day'}
      />
    </div>
  )
}
