import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@louez/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { generateStoreMetadata } from '@/lib/seo'
import type { StoreSettings, StoreTheme } from '@louez/types'

interface CGVPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: CGVPageProps): Promise<Metadata> {
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
      title: `Conditions générales de vente - ${store.name}`,
      description: `Consultez les conditions générales de vente et de location de ${store.name}.`,
      path: '/terms',
    }
  )
}

export default async function CGVPage({ params }: CGVPageProps) {
  const t = await getTranslations('storefront.legal')
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="sm" render={<Link href="/" />}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('back')}
        </Button>
      </div>

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <FileText className="h-8 w-8" />
          <h1 className="text-3xl font-bold">{t('cgv.title')}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{store.name}</CardTitle>
          </CardHeader>
          <CardContent>
            {store.cgv ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-a:text-primary"
                dangerouslySetInnerHTML={{ __html: store.cgv }}
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>{t('cgv.noCgv')}</p>
                <p className="text-sm mt-2">
                  {t('cgv.contactSeller')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contact Info */}
        {(store.email || store.phone) && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t('contact')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {store.email && (
                <p>
                  <span className="font-medium">{t('legalNotice.email')}:</span>{' '}
                  <a
                    href={`mailto:${store.email}`}
                    className="text-primary hover:underline"
                  >
                    {store.email}
                  </a>
                </p>
              )}
              {store.phone && (
                <p>
                  <span className="font-medium">{t('legalNotice.phone')}:</span>{' '}
                  <a
                    href={`tel:${store.phone}`}
                    className="text-primary hover:underline"
                  >
                    {store.phone}
                  </a>
                </p>
              )}
              {store.address && (
                <p>
                  <span className="font-medium">{t('legalNotice.address')}:</span> {store.address}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
