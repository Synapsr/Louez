import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ArrowLeft, ShoppingBag } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CartContent } from './cart-content'
import { generateStoreMetadata } from '@/lib/seo'
import type { StoreSettings, StoreTheme } from '@/types/store'

interface CartPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: CartPageProps): Promise<Metadata> {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings as StoreSettings,
      theme: store.theme as StoreTheme,
    },
    {
      title: `Panier - ${store.name}`,
      description: `Votre panier de location chez ${store.name}.`,
      noIndex: true,
    }
  )
}

export default async function CartPage({ params }: CartPageProps) {
  const { slug } = await params
  const t = await getTranslations('storefront.cart')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  const pricingMode = store.settings?.pricingMode || 'day'

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/catalog">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('continueShopping')}
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-8">
        <ShoppingBag className="h-8 w-8" />
        <h1 className="text-3xl font-bold">{t('title')}</h1>
      </div>

      <CartContent storeSlug={slug} pricingMode={pricingMode} />
    </div>
  )
}
