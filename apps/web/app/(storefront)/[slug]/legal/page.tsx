import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { ArrowLeft, Scale } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@louez/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@louez/ui'
import { generateStoreMetadata } from '@/lib/seo'
import type { StoreSettings, StoreTheme } from '@louez/types'

interface LegalNoticePageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: LegalNoticePageProps): Promise<Metadata> {
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
      title: `Mentions légales - ${store.name}`,
      description: `Mentions légales et informations juridiques de ${store.name}.`,
      path: '/legal',
    }
  )
}

export default async function LegalNoticePage({ params }: LegalNoticePageProps) {
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
        <Button variant="ghost" render={<Link href="/" />}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('back')}
        </Button>
      </div>

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Scale className="h-8 w-8" />
          <h1 className="text-3xl font-bold">{t('legalNotice.title')}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('legalNotice.editorInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {store.legalNotice ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-a:text-primary"
                dangerouslySetInnerHTML={{ __html: store.legalNotice }}
              />
            ) : (
              <>
                <div className="space-y-2">
                  <p>
                    <span className="font-medium">{t('legalNotice.companyName')}:</span> {store.name}
                  </p>
                  {store.address && (
                    <p>
                      <span className="font-medium">{t('legalNotice.headquarters')}:</span> {store.address}
                    </p>
                  )}
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
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t('hosting.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('hosting.description')}
            </p>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t('intellectualProperty.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('intellectualProperty.content1', { name: store.name })}
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              {t('intellectualProperty.content2', { name: store.name })}
            </p>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t('personalData.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {t('personalData.content1', { name: store.name })}
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              {t('personalData.content2')}{' '}
              {store.email ? (
                <a
                  href={`mailto:${store.email}`}
                  className="text-primary hover:underline"
                >
                  {store.email}
                </a>
              ) : (
                t('personalData.siteManager')
              )}
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
